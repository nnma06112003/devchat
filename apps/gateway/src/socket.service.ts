import { Injectable, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';

export type AuthSocket = Socket & { user?: { id: string } };


@Injectable()
export class ChatSocketService {
  private server: Server;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

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
  async sendMessageToChannel(channelId: string, message: any) {
    this.server.to(channelId).emit('receiveMessage', message);
    await this.incrementUnread(channelId, message.senderId);
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
