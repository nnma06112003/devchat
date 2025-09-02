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
  async markUserOnline(userId: string) {
    if (!userId) return;

    await this.redis.hset('user_status', userId, JSON.stringify({
      online: true,
      lastSeen: Date.now(),
    }));

    console.log(`🟢 User online: ${userId}`);
    this.server.emit('presenceUpdate', { online: [userId], offline: [] });
  }

  /** User offline */
  async markUserOffline(userId: string) {
    if (!userId) return;

    const lastSeen = Date.now();
    await this.redis.hset('user_status', userId, JSON.stringify({
      online: false,
      lastSeen,
    }));

    console.log(`🔴 User offline: ${userId}`);
    this.server.emit('presenceUpdate', { online: [], offline: [{ userId, lastSeen }] });
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

  /** Send message */
async sendMessageToChannel(message: { channelId: string; text: string; user: any }) {
  const tempId = Date.now(); // id tạm thời cho pending message
  const now = new Date().toISOString();

  // 1. Emit tin nhắn pending cho chính sender
//   const pendingMsg: any = {
//     id: tempId,
//     text: message.text,
//     created_at: now,  // tạm coi created_at = thời gian client gửi
//     updated_at: null,
//     sender: {
//       id: message.user.id,
//       username: message.user.username,
//       email: message.user.email,
//     },
//     isMine: true,
//     // status: 'pending',
//   };

//   this.server.to(message.channelId).emit('receiveMessage', pendingMsg);

  try {
    // 2. Lưu DB
    const savedMsg = await this.gw.exec('chat', 'sendMessage', { ...message, send_at: now });

    // 3. Emit bản tin chính thức
    const msg: any= {
      id: savedMsg.id,
      text: savedMsg.text,
      created_at: savedMsg.created_at,
      updated_at: savedMsg.updated_at,
      sender: {
        id: savedMsg.sender.id || message.user.id,
        username: savedMsg.sender.username || message.user.username,
        email: savedMsg.sender.email || message.user.email,
      },
      isMine: savedMsg.sender.id === message.user.id,
    //   status: 'delivered',
    };

    this.server.to(message.channelId).emit('receiveMessage', msg);

    // 4. Tăng unread cho các user khác
    await this.incrementUnread(message.channelId, message.user.id);
  } catch (err) {
    // 5. Emit lỗi cho sender
    const failedMsg: any = {
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
    //   status: 'failed',
    };

    this.server.to(message.channelId).emit('receiveMessage', failedMsg);
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
