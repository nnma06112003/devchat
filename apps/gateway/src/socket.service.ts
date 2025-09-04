import { Injectable, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { GatewayService } from './gateway.service';
import { text } from 'stream/consumers';
import { Message } from '@myorg/entities';

export type AuthSocket = Socket & { user?: { id: string } };


@Injectable()
export class ChatSocketService {
  private server: Server;

    constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis,private readonly gw: GatewayService) { }


  setServer(server: Server) {
    this.server = server;
  }

  /** User online */
async markUserOnline(userId: string, socketId: string) {
  if (!userId) return;

  // Cập nhật Redis
  await this.redis.hset(
    "user_status",
    userId,
    JSON.stringify({
      online: true,
      lastSeen: Date.now(),
      socketId,
    })
  );

  // Lấy toàn bộ user_status từ Redis
  const all = await this.redis.hgetall("user_status");

  // Lọc ra những user đang online
  const onlineUsers: string[] = [];
  for (const [uid, data] of Object.entries(all)) {
    try {
      const status = JSON.parse(data);
      if (status.online) {
        onlineUsers.push(uid);
      }
    } catch (err) {
      console.error("❌ Parse user_status lỗi", uid, err);
    }
  }

  console.log(`🟢 User online: ${userId} - socket ${socketId}`);
  console.log(`📢 Online list: ${onlineUsers.join(", ")}`);

  // Emit danh sách online đầy đủ
  this.server.emit("presenceUpdate", {
    online: onlineUsers,
    offline: [],
  });
}



  /** User offline */
async markUserOffline(userId: string) {
  if (!userId) return;

  const lastSeen = Date.now();

  // Cập nhật trạng thái offline vào Redis
  await this.redis.hset(
    "user_status",
    userId,
    JSON.stringify({
      online: false,
      lastSeen,
    })
  );

  // Lấy toàn bộ user_status từ Redis
  const all = await this.redis.hgetall("user_status");

  // Lọc ra user đang online
  const onlineUsers: string[] = [];
  for (const [uid, data] of Object.entries(all)) {
    try {
      const status = JSON.parse(data);
      if (status.online) {
        onlineUsers.push(uid);
      }
    } catch (err) {
      console.error("❌ Parse user_status lỗi", uid, err);
    }
  }

  console.log(`🔴 User offline: ${userId}`);
  console.log(`📢 Online list: ${onlineUsers.join(", ")}`);

  // Emit: danh sách online hiện tại + user vừa offline
  this.server.emit("presenceUpdate", {
    online: onlineUsers,
    offline: [{ userId, lastSeen }],
  });
}


  /** Lấy trạng thái 1 user */
  async getUserStatus(userId: string) {
    const data = await this.redis.hget('user_status', userId);
    return data ? JSON.parse(data) : { online: false, lastSeen: null };
  }

  /** Join channel */
  async joinChannel(client: AuthSocket, channelId: string) {
    client.join(channelId);
    await this.resetUnread(client, channelId);
    client.emit('joinedRoom', { channelId });
    console.log(`✅ User ${client.user?.id} joined channel ${channelId}`);
  }

  /** Leave channel */
  leaveChannel(client: AuthSocket, channelId: string) {
    client.leave(channelId);
    console.log(`🚪 User ${client.user?.id} left channel ${channelId}`);
  }

  /** Switch channel */
  async switchChannel(client: AuthSocket, oldChannelId: string, newChannelId: string) {
    this.leaveChannel(client, oldChannelId);
    await this.joinChannel(client, newChannelId);
  } 

  async createChannel(data: { userIds: string[]; name: string; user: any; type?: string }) {
   
    const tempId = Date.now();
    const now = new Date().toISOString();
    const channel: any = {
      id: tempId,
      fakeID: tempId,
      name: data?.name,
      type: data?.type,
      member_count: data?.userIds?.length + 1,
      members:[],
      isActive: true,
      created_at: now,
      updated_at: now,
    };
    if (data?.type !== 'personal') {
      for (const uid of data.userIds) {
        // lấy socketId từ Redis
        const statusStr = await this.redis.hget('user_status', uid);
        if (statusStr) {
          const status = JSON.parse(statusStr);
          if (status.online && status.socketId) {
            this.server.to(status.socketId).emit('receiveChannel', channel);
            console.log(`📢 Sent channel to user ${uid} at socket ${status.socketId}`);
          }
        }
      }
    }
  
   
   try {
  const savedChannel: any = await this.gw.exec('chat', 'createChannel', data);

  if (savedChannel?.data) {
    const msg: any = {
      ...savedChannel.data,          // lấy toàn bộ dữ liệu DB
      fakeID: channel.fakeID,   // giữ fakeID để map client
    };

    for (const uid of data.userIds) {
      const statusStr = await this.redis.hget('user_status', uid);
      if (statusStr) {
        const status = JSON.parse(statusStr);
        if (status.online && status.socketId) {
          this.server.to(status.socketId).emit('receiveChannel', msg);
          console.log(`📢 Sent channel to user ${uid} at socket ${status.socketId} with ${JSON.stringify(msg)}`);
        }
      }
    }
  }

    

  } catch (err) {
    console.error(`❌ Error creating channel: ${err}`);
  }
}

  /** Send message */
async sendMessageToChannel(message: { channelId: string; text: string; user: any; channelData?: any }) {
  const tempId = Date.now(); 
  const now = new Date().toISOString();

  // Emit UI pending message
  const pendingMsg: any = {
    id: tempId,
    text: message.text,
    created_at: now,
    updated_at: null,
    sender: {
      id: message.user.id,
      username: message.user.username,
      email: message.user.email,
    },
    isMine: true,
  };
  this.server.to(message.channelId).emit('receiveMessage', pendingMsg);

  // Nếu channel tồn tại và chưa active
if (message.channelData && message.channelData.isActive === false) {
  // Update lại channel thành active
  const activeChannel = {
    ...message.channelData,
    isActive: true,
  };

  // Duyệt qua từng member trong channel
  for (const member of message.channelData.members) {
    const uid = member.id; // hoặc member.userId tuỳ DB
    const statusStr = await this.redis.hget('user_status', uid);

    if (statusStr) {
      const status = JSON.parse(statusStr);
      if (status.online && status.socketId) {
        this.server.to(status.socketId).emit('receiveChannel', activeChannel);
        console.log(`📢 Sent activeChannel to user ${uid} at socket ${status.socketId}`);
      }
    }
  }
}

  try {
    // Lưu DB
    await this.gw.exec('chat', 'sendMessage', { ...message, send_at: now });
    await this.incrementUnread(message.channelId, message.user.id);
  } catch (err) {
    // Nếu lỗi -> emit lại pendingMsg để client biết
    this.server.to(message.channelId).emit('receiveMessage', pendingMsg);
  }
}




  /** Tăng unread */
  private async incrementUnread(channelId: string, senderId: string) {
    const sockets: any[] = await this.server.in(channelId).fetchSockets();

    for (const socket of sockets) {
      const userId = socket.user?.id || socket.data?.user?.id;
      if (userId && userId !== senderId) {
        const key = `unread:${userId}`;
        const count = await this.redis.hincrby(key, channelId, 1);
        socket.emit('unreadCount', { channelId, count });
      }
    }
  }

  /** Reset unread */
  private async resetUnread(client: AuthSocket, channelId: string) {
    const userId = client.user?.id || client.data?.user?.id;
    if (!userId) return;

    const key = `unread:${userId}`;
    await this.redis.hset(key, channelId, 0);
    client.emit('unreadCount', { channelId, count: 0 });
  }

  /** Lấy toàn bộ unread */
  async getUnreadMap(userId: string): Promise<Record<string, number>> {
    const key = `unread:${userId}`;
    const data = await this.redis.hgetall(key);
    const result: Record<string, number> = {};
    for (const [channelId, count] of Object.entries(data)) {
      result[channelId] = parseInt(count, 10);
    }
    return result;
  }
}
