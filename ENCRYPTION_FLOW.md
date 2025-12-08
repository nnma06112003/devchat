# 🔐 Encryption Flow Documentation

## Tổng quan

Hệ thống sử dụng **AES-256-CBC** với **deterministic IV** để mã hóa tất cả các ID trong:
- JWT tokens (field `sub`)
- HTTP responses
- WebSocket messages

**Key principle**: Cùng ID → Cùng encrypted value (deterministic)

## Environment Variable

```env
ID_ENCRYPTION_KEY=your-secret-key-minimum-32-characters-long
```

## Format mã hóa

```
ENC:base64(iv_hex:encrypted_hex)
```

Ví dụ:
```
Original: 123
Encrypted: ENC:YWJjZGVmOjEyMzQ1Njc4OTBhYmNkZWY=
```

---

## Luồng 1: HTTP Request/Response

### 1.1 User tạo channel

```
Frontend → Gateway → Chat Service → PostgreSQL
```

**Request:**
```json
POST /api/chat/channels
{
  "name": "Channel 1",
  "userIds": ["456", "789"]  // Frontend gửi ID gốc
}
```

**Response từ Chat Service:**
```json
{
  "status": 200,
  "data": {
    "id": 123,
    "name": "Channel 1",
    "members": [
      { "id": 456, "username": "user1" },
      { "id": 789, "username": "user2" }
    ]
  }
}
```

**Gateway mã hóa response:**
```typescript
// gateway.service.ts -> exec()
const encryptedResult = this.encryptIdsInData(result);
```

**Response đến Frontend:**
```json
{
  "status": 200,
  "data": {
    "id": "ENC:abc123...",
    "name": "Channel 1",
    "members": [
      { "id": "ENC:def456...", "username": "user1" },
      { "id": "ENC:ghi789...", "username": "user2" }
    ]
  }
}
```

### 1.2 Frontend lưu và gửi lại

**Frontend lưu:**
```javascript
selectedChannel = {
  id: "ENC:abc123...",
  name: "Channel 1"
}
```

**Gửi message:**
```json
POST /api/chat/messages
{
  "channelId": "ENC:abc123...",  // Frontend gửi ID đã mã hóa
  "text": "Hello"
}
```

**Gateway nhận và GIỮ NGUYÊN** (không decrypt):
```typescript
// gateway.service.ts -> exec()
// Frontend đã gửi encrypted ID, service nhận trực tiếp
const res$ = this.kafka.send(topic, { cmd, data });
```

**Chat Service nhận:**
```json
{
  "channelId": "ENC:abc123...",
  "text": "Hello"
}
```

❌ **ISSUE**: Chat Service không thể query PostgreSQL với encrypted ID!

---

## ⚠️ Vấn đề cần giải quyết

### Option 1: Gateway decrypt request (RECOMMENDED)

Gateway phải decrypt request trước khi gửi đến service:

```typescript
// gateway.service.ts -> exec()
async exec(service, cmd, data, opts) {
  // Decrypt incoming data từ frontend
  const decryptedData = this.decryptIdsInData(data);
  
  // Gửi ID gốc đến service
  const result = await this.kafka.send(topic, { cmd, data: decryptedData });
  
  // Encrypt response trước khi trả về
  return this.encryptIdsInData(result);
}
```

**Lợi ích:**
- ✅ Services nhận ID gốc, query PostgreSQL bình thường
- ✅ Redis lưu ID gốc
- ✅ WebSocket hoạt động với ID gốc
- ✅ Chỉ Frontend nhận encrypted IDs

### Option 2: Services tự decrypt (NOT RECOMMENDED)

Mỗi service phải có encryption logic:
- ❌ Duplicate code
- ❌ Khó maintain
- ❌ Services phải biết encryption key

---

## Luồng 2: JWT Authentication

### 2.1 Login/Register

**Auth Service:**
```typescript
// auth.service.ts -> login()
const payload = {
  sub: this.encryptId(user.id),  // Mã hóa user ID
  email: user.email,
  username: user.username,
  role: user.role
};
const access_token = this.jwtService.sign(payload);
```

**JWT Payload:**
```json
{
  "sub": "ENC:xyz123...",
  "email": "user@example.com",
  "username": "john",
  "role": "user",
  "iat": 1234567890,
  "exp": 1234571490
}
```

### 2.2 Verify Token

**Auth Service:**
```typescript
// auth.service.ts -> validateToken()
const payload = this.jwtService.verify(token);

// Giải mã sub để lấy user ID gốc
const userId = this.decryptId(payload.sub);
const user = await this.userRepository.findById(userId);
```

**Return về Gateway:**
```json
{
  "id": 123,  // ID gốc
  "email": "user@example.com",
  "username": "john",
  "role": "user"
}
```

---

## Luồng 3: WebSocket

### 3.1 Socket Authentication

**Adapter:**
```typescript
// socket-io.adapter.ts
socket.use(async (socket, next) => {
  const data = await this.gatewayService.exec('auth', 'verify_token', { token });
  
  // Auth service trả về ID gốc
  socket.user = { id: data.data.id };
});
```

### 3.2 WebSocket Messages

**Frontend gửi:**
```javascript
socket.emit('send_message', {
  channelId: "ENC:abc123...",  // Encrypted
  text: "Hello"
});
```

**Socket Service nhận:**
```typescript
// socket.service.ts -> sendMessageToChannel()
async sendMessageToChannel(message) {
  // ⚠️ CẦN DECRYPT message.channelId
  const channelId = this.decryptId(message.channelId);
  
  // Query PostgreSQL với ID gốc
  await this.chatService.saveMessage(channelId, message.text);
}
```

**Emit về Frontend:**
```typescript
// Mã hóa trước khi emit
const encryptedMessage = this.encryptIdsInData(pendingMsg);
this.server.to(channelId).emit('newMessage', encryptedMessage);
```

---

## Luồng 4: Redis

### 4.1 User Status

**Lưu vào Redis:**
```typescript
// socket.service.ts
await this.redis.hset(
  'user_status',
  userId,  // ID gốc (chưa mã hóa)
  JSON.stringify({ online: true, lastSeen: Date.now() })
);
```

### 4.2 Unread Channels

**Lưu vào Redis:**
```typescript
await this.redis.hincrby(
  `unread:${userId}`,  // ID gốc
  channelId,  // ID gốc
  1
);
```

**Lấy từ Redis và mã hóa:**
```typescript
const unreadMap = await this.redis.hgetall(`unread:${userId}`);

// Mã hóa trước khi gửi đến Frontend
const encrypted = {};
for (const [channelId, count] of Object.entries(unreadMap)) {
  encrypted[this.encryptId(channelId)] = count;
}
```

---

## Implementation Checklist

### ✅ Đã hoàn thành

1. [x] Gateway Service
   - [x] `encryptId()` method
   - [x] `decryptId()` method
   - [x] `encryptIdsInData()` - đệ quy
   - [x] `decryptIdsInData()` - đệ quy
   - [x] `exec()` - mã hóa response

2. [x] Auth Service
   - [x] `encryptId()` method
   - [x] `decryptId()` method
   - [x] Login - mã hóa `payload.sub`
   - [x] Register - mã hóa `payload.sub`
   - [x] RefreshToken - mã hóa `payload.sub`
   - [x] ValidateToken - giải mã `payload.sub`
   - [x] GetTokenUserData - mã hóa `payload.sub`

3. [x] Socket Adapter
   - [x] Verify token - sử dụng ID gốc từ auth

### ⚠️ Cần cập nhật

1. [ ] Gateway Service
   - [ ] `exec()` - **THÊM** decrypt request từ frontend
   ```typescript
   const decryptedData = this.decryptIdsInData(data);
   const result = await this.kafka.send(topic, { cmd, data: decryptedData });
   ```

2. [ ] Socket Service
   - [ ] `sendMessageToChannel()` - decrypt `message.channelId`
   - [ ] `createChannel()` - decrypt `data.userIds[]`
   - [ ] `updateChannel()` - decrypt IDs trong data
   - [ ] `joinChannel()` - decrypt `channelId`
   - [ ] `getUnreadMap()` - encrypt keys trước khi return

3. [ ] Chat Gateway
   - [ ] Tất cả handlers - decrypt incoming data từ socket

---

## Testing

### Test 1: HTTP Flow

```bash
# 1. Login
curl -X POST http://localhost:3000/api/auth/login \
  -d '{"email":"user@example.com","password":"pass123"}'

# Response: { "access_token": "eyJ...", "user": { "id": "ENC:..." } }

# 2. Create Channel
curl -X POST http://localhost:3000/api/chat/channels \
  -H "Authorization: Bearer eyJ..." \
  -d '{"name":"Test Channel","userIds":["ENC:..."]}'

# Response: { "id": "ENC:...", "name": "Test Channel" }

# 3. Send Message
curl -X POST http://localhost:3000/api/chat/messages \
  -H "Authorization: Bearer eyJ..." \
  -d '{"channelId":"ENC:...","text":"Hello"}'
```

### Test 2: WebSocket Flow

```javascript
// Frontend
const socket = io('http://localhost:3000', {
  auth: { token: localStorage.getItem('access_token') }
});

// Join channel với encrypted ID
socket.emit('join_channel', { channelId: 'ENC:...' });

// Send message
socket.emit('send_message', {
  channelId: 'ENC:...',
  text: 'Hello from socket'
});

// Receive message với encrypted IDs
socket.on('newMessage', (msg) => {
  console.log(msg.id); // ENC:...
  console.log(msg.senderId); // ENC:...
  console.log(msg.channelId); // ENC:...
});
```

---

## Security Notes

### ✅ Best Practices

1. **Environment Variable**: Luôn dùng `process.env.ID_ENCRYPTION_KEY`
2. **Key Length**: Minimum 32 characters
3. **Deterministic IV**: Cùng ID → cùng encrypted (để cache, compare)
4. **Prefix**: `ENC:` để dễ identify
5. **Base64**: Encode để transport-safe

### ⚠️ Known Limitations

1. **Deterministic Encryption**: Có thể identify cùng ID trong requests khác nhau
2. **No Authentication**: Encryption không replace authentication
3. **Client-side**: Frontend có thể decode base64 (nhưng không decrypt)
4. **Pattern Analysis**: Attacker có thể phân tích patterns nếu xem nhiều requests

### 🔒 Recommendations

1. **HTTPS**: Bắt buộc sử dụng HTTPS
2. **Rate Limiting**: Prevent brute force attacks
3. **Token Expiry**: Short-lived access tokens
4. **Audit Logs**: Log tất cả decryption attempts
5. **Key Rotation**: Plan for key rotation strategy

---

## Troubleshooting

### Issue 1: "ID không hợp lệ hoặc đã bị thay đổi"

**Nguyên nhân**: 
- Encrypted ID bị modify
- Sai encryption key
- Format không đúng

**Giải pháp**:
```typescript
// Check encryption key
console.log(process.env.ID_ENCRYPTION_KEY);

// Verify format
const isValid = encryptedId.startsWith('ENC:');
```

### Issue 2: PostgreSQL query failed

**Nguyên nhân**: Service nhận encrypted ID thay vì ID gốc

**Giải pháp**: Gateway phải decrypt request trước khi gửi đến service

### Issue 3: Redis keys không match

**Nguyên nhân**: Mix encrypted và unencrypted IDs

**Giải pháp**: Redis luôn lưu ID gốc, chỉ encrypt khi trả về frontend

---

## Migration Guide

Nếu đã có data cũ chưa encrypted:

### Option 1: Backward Compatible

```typescript
decryptId(id: string): string {
  // Nếu chưa encrypted, trả về nguyên
  if (!id.startsWith('ENC:')) {
    return id;
  }
  // Decrypt
  return this.decrypt(id);
}
```

### Option 2: Migration Script

```typescript
// Migrate existing tokens
async migrateTokens() {
  const users = await this.userRepo.find();
  
  for (const user of users) {
    if (user.refresh_token && !user.refresh_token.includes('ENC:')) {
      // Re-generate token với encrypted sub
      const newToken = await this.generateAndSaverefresh_token(user);
      console.log(`Migrated user ${user.id}`);
    }
  }
}
```

---

## Contact

Nếu có vấn đề, kiểm tra:
1. Environment variable `ID_ENCRYPTION_KEY`
2. Gateway logs: `🔐 [ENCRYPT]` và `🔓 [DECRYPT]`
3. Auth service logs: `encrypted user id` và `decrypted user id`
