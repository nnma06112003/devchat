// socket.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { GatewayService } from './gateway.service';
import { Message } from '@myorg/entities';
import { json } from 'stream/consumers';
import { channel } from 'diagnostics_channel';

export type AuthSocket = Socket & { user?: { id: string } };

@Injectable()
export class ChatSocketService {
  private server: Server;
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly gw: GatewayService,
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  /* ===================== UNREAD HELPERS ===================== */
  private unreadKey = (userId: string) => `unread:${userId}`;
  private subKey = (socketId: string) => `unread_subscribe:${socketId}`;

  /** Lấy toàn bộ unread cho user (unify) */
  async getUnreadMap(userId: string): Promise<Record<string, number>> {
    const data = await this.redis.hgetall(this.unreadKey(userId));
    const result: Record<string, number> = {};
    for (const [channelId, count] of Object.entries(data)) {
      result[channelId] = parseInt(count, 10) || 0;
    }
    return result;
  }

  /** Đăng ký danh sách kênh muốn nhận thông báo unread cho socketId */
  async registerUnreadChannels(socketId: string, channelIds: string[]) {
    await this.redis.set(
      this.subKey(socketId),
      JSON.stringify(channelIds || []),
    );
  }

  /** Lấy danh sách kênh đã đăng ký nhận thông báo unread cho socketId */
  async getRegisteredUnreadChannels(socketId: string): Promise<string[]> {
    const data = await this.redis.get(this.subKey(socketId));
    return data ? JSON.parse(data) : [];
  }

  /* ===================== PRESENCE ===================== */
  async markUserOnline(userId: string, socketId: string) {
    await this.redis.hset(
      'user_status',
      userId,
      JSON.stringify({ online: true, lastSeen: Date.now(), socketId }),
    );

    // Emit presence (giữ nguyên log/format bạn đang dùng)
    const all = await this.redis.hgetall('user_status');
    const onlineUsers: string[] = [];
    for (const [uid, data] of Object.entries(all)) {
      try {
        const status = JSON.parse(data);
        if (status.online) onlineUsers.push(uid);
      } catch (err) {
        console.error('❌ Parse user_status lỗi', uid, err);
      }
    }
    this.server.emit('presenceUpdate', { online: onlineUsers, offline: [] });
  }

  async markUserOffline(userId: string) {
    const lastSeen = Date.now();
    await this.redis.hset(
      'user_status',
      userId,
      JSON.stringify({ online: false, lastSeen }),
    );

    const all = await this.redis.hgetall('user_status');
    const onlineUsers: string[] = [];
    for (const [uid, data] of Object.entries(all)) {
      try {
        const status = JSON.parse(data);
        if (status.online) onlineUsers.push(uid);
      } catch (err) {
        console.error('❌ Parse user_status lỗi', uid, err);
      }
    }
    this.server.emit('presenceUpdate', {
      online: onlineUsers,
      offline: [{ userId, lastSeen }],
    });
  }

  async getUserStatus(userId: string) {
    const data = await this.redis.hget('user_status', userId);
    return data ? JSON.parse(data) : { online: false, lastSeen: null };
  }

  /* ===================== ROOM OPS ===================== */
  async joinChannel(client: AuthSocket, channelId: string) {
    // Nếu client đã ở trong room này thì không emit nữa
    // if (client.rooms.has(channelId)) {
    //   console.log(
    //     `⚠️ User ${client.user?.id} đã ở trong channel ${channelId}, không emit joinedRoom`,
    //   );
    //   return;
    // }
    client.join(channelId);
    await this.resetUnread(client, channelId);
    client.emit('joinedRoom', { channelId });
    console.log(`✅ User ${client.user?.id} joined channel ${channelId}`);
  }

  leaveChannel(client: AuthSocket, channelId: string) {
    client.leave(channelId);
    console.log(`🚪 User ${client.user?.id} left channel ${channelId}`);
  }

  async switchChannel(
    client: AuthSocket,
    oldChannelId: string,
    newChannelId: string,
  ) {
    this.leaveChannel(client, oldChannelId);
    await this.joinChannel(client, newChannelId);
  }

  /* ===================== CHANNEL & MESSAGE ===================== */
  async createChannel(data: {
    userIds: string[];
    name: string;
    user: any;
    type?: string;
  }) {
    const tempId = Date.now();
    const now = new Date().toISOString();
    const channel: any = {
      id: tempId,
      fakeID: tempId,
      name: data?.name,
      type: data?.type,
      member_count: (data?.userIds?.length ?? 0) + 1,
      members: [],
      isActive: true,
      created_at: now,
      updated_at: now,
    };

    if (data?.type !== 'personal') {
      for (const uid of data.userIds) {
        const statusStr = await this.redis.hget('user_status', uid);
        if (!statusStr) continue;
        const status = JSON.parse(statusStr);
        if (status.online && status.socketId) {
          this.server.to(status.socketId).emit('receiveChannel', channel);
          console.log(
            `📢 Sent channel to user ${uid} at socket ${status.socketId}`,
          );
        }
      }
    }

    try {
      const savedChannel: any = await this.gw.exec(
        'chat',
        'createChannel',
        data,
      );
      if (savedChannel?.data) {
        const msg: any = { ...savedChannel.data, fakeID: channel.fakeID };
        for (const uid of data.userIds) {
          const statusStr = await this.redis.hget('user_status', uid);
          if (!statusStr) continue;
          const status = JSON.parse(statusStr);
          if (status.online && status.socketId) {
            this.server.to(status.socketId).emit('receiveChannel', msg);
            console.log(
              `📢 Sent channel to user ${uid} at socket ${status.socketId} with ${JSON.stringify(msg)}`,
            );
          }
        }
      }
    } catch (err) {
      console.error(`❌ Error creating channel: ${err}`);
    }
  }

  async sendMessageToChannel(message: {
    channelId: string;
    text: string;
    user: any;
    type?: string;
    channelData?: any;
    json_data?: any;
  }) {
    console.log(`🔍 [DEBUG] sendMessageToChannel called with:`, {
      channelId: message.channelId,
      type: message.type,
      text: message.text?.substring(0, 100) + '...',
      hasJsonData: !!message.json_data,
      jsonDataType: typeof message.json_data
    });

    const tempId = Date.now();
    const now = new Date().toISOString();
    const typeMsg = message.type ?? 'message';
    
    console.log(`🔍 [DEBUG] Message type: ${message.type} -> ${typeMsg}`);
    
    // Emit pending vào room
    const pendingMsg: any = {
      id: tempId,
      channelId: message.channelId,
      fakeID: tempId,
      text: message.text,
      type: typeMsg,
      created_at: now,
      updated_at: null,
      json_data: message.json_data ? { ...message.json_data } : null,
      sender: {
        id: message.user.id,
        username: message.user.username,
        email: message.user.email,
      },
      isMine: true,
      status: 'pending',
    };

    // console.log(`🔍 [DEBUG] Pending message created:`, {
    //   type: pendingMsg.type,
    //   fakeID: pendingMsg.fakeID,
    //   hasJsonData: !!pendingMsg.json_data
    // });

    // Emit pending message to room
    if (this.server) {
      //console.log(`🔍 [DEBUG] Emitting pending message to channel ${message.channelId}`);
      this.server.to(message.channelId).emit('receiveMessage', pendingMsg);
      //console.log(`✅ [DEBUG] Pending message emitted successfully`);
    } else {
      console.error(`❌ [DEBUG] Server not available for emitting pending message`);
    }

    // Nếu channel chưa active → bật active & gửi cập nhật channel cho members đang online
    if (message.channelData && message.channelData.isActive === false) {
      const activeChannel = { ...message.channelData, isActive: true };
      for (const member of message.channelData.members || []) {
        const uid = member.id;
        const statusStr = await this.redis.hget('user_status', uid);
        if (!statusStr) continue;
        const status = JSON.parse(statusStr);
        if (status.online && status.socketId && this.server) {
          this.server.to(status.socketId).emit('receiveChannel', activeChannel);

          console.log(
            `📢 Sent activeChannel to user ${uid} at socket ${status.socketId}`,
          );
        }
      }
    }

    try {
      // console.log(`🔍 [DEBUG] Calling chat service with:`, {
      //   ...message,
      //   send_at: now,
      //   json_data_type: typeof message.json_data
      // });

      const res: any = await this.gw.exec('chat', 'sendMessage', {
        ...message,
        send_at: now,
      });
      
      // console.log(`🔍 [DEBUG] Chat service response:`, {
      //   hasData: !!res?.data,
      //   responseType: res?.data?.type,
      //   dataKeys: res?.data ? Object.keys(res.data) : 'no data'
      // });
      
      const { channel, ...datas } = res?.data;
      // console.log(`📨 Message sent in channel ${message.channelId}:`,  {
      //   ...datas,
      //   channelId: message.channelId,
      //   type: typeMsg,
      //   fakeID: tempId,
      //   status: 'sent',
      // });

      const finalMessage = {
        ...datas,
        channelId: message.channelId,
        type: typeMsg,
        fakeID: tempId,
        status: 'sent',
      };

      // console.log(`🔍 [DEBUG] Final message to emit:`, {
      //   type: finalMessage.type,
      //   fakeID: finalMessage.fakeID,
      //   hasJsonData: !!finalMessage.json_data,
      //   id: finalMessage.id
      // });
      
      // Kiểm tra server tồn tại trước khi emit
      this.server.to(message.channelId).emit('receiveMessage', finalMessage);
      const result = await this.gw.exec('notification', 'send_notification', {
        ...res,
        type:'message',
      });

      if (result?.data) {
        for (const notify of result?.data.notifications) {
        const statusStr = await this.redis.hget('user_status', notify?.userId);
        if (!statusStr) continue;
        const status = JSON.parse(statusStr);
        if (status.online && status.socketId && this.server) {
          this.server.to(status.socketId).emit('receiveNotification', {
            ...notify ,
            fakeID: tempId,
          });
          console.log(
            `📢 Sent channel to user ${notify?.userId} at socket ${status.socketId}`,
          );
        }
      }
      }
      await this.incrementUnread(
        String(message.channelId),
        String(message.user.id),
      );
    } catch (err: any) {
      console.error(`❌ [DEBUG] Error sending message to channel ${message.channelId}:`, err);
      console.error(`❌ [DEBUG] Error details:`, {
        message: err?.message,
        stack: err?.stack,
        originalMessageType: message.type
      });
      
      if (this.server) {
        const errorMessage = {
          ...pendingMsg,
          status: 'error',
          msg: err?.message || 'Gửi tin nhắn thất bại',
        };
        
        console.log(`🔍 [DEBUG] Emitting error message:`, {
          type: errorMessage.type,
          fakeID: errorMessage.fakeID,
          status: errorMessage.status
        });
        
        this.server.to(message.channelId).emit('receiveMessage', errorMessage);
      }
    }
  }

  /* ===================== UNREAD CORE ===================== */
  private async incrementUnread(channelId: string, senderId: string) {
    const sockets: any[] = await this.server.fetchSockets(); // tất cả socket đang online
    for (const socket of sockets) {
      const socketId = socket.id;
      const userId = socket.user?.id || socket.data?.user?.id;
      if (!userId || String(userId) === String(senderId)) continue;

      // socket này có đăng ký theo dõi unread cho channelId không?
      const registeredChannels =
        await this.getRegisteredUnreadChannels(socketId);
      const isReg = registeredChannels.includes(String(channelId));

      // socket này có ở trong room channelId không?
      const isInChannel = socket.rooms.has(String(channelId));

      if (isReg && !isInChannel) {
        const key = this.unreadKey(String(userId));
        const count = await this.redis.hincrby(key, String(channelId), 1);
        socket.emit('unreadCount', { channelId: String(channelId), count });
      }
    }
  }

  private async resetUnread(client: AuthSocket, channelId: string) {
    const userId = client.user?.id || client.data?.user?.id;
    if (!userId) return;
    const key = this.unreadKey(String(userId));
    await this.redis.hset(key, String(channelId), 0);
    client.emit('unreadCount', { channelId: String(channelId), count: 0 });
  }


   async broadcastWebhook(data: any) {
    try {
      const installationId = data.installationId;
      const tempId = Date.now();
      if (!installationId) return;

      const result = await this.gw.exec('notification', 'send_notification', { ...data ,type:'github' });
      if (result?.data) {
        for (const notify of result?.data.notifications) {
          const statusStr = await this.redis.hget('user_status', notify?.userId);
          if (!statusStr) continue;
          const status = JSON.parse(statusStr);
          if (status.online && status.socketId) {
            this.server.to(status.socketId).emit('receiveNotification', {
              ...notify,
              fakeID: tempId,
            });
            console.log('data github notification',{ ...notify});
            console.log(
              `📢 Sent channel to user ${notify?.userId} at socket ${status.socketId}`,
            );
          }
        }
      } 
    } catch (error) {
      //console.error(`Error broadcasting webhook: ${error.message}`);
    }
  }
}
