import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server ,Socket} from 'socket.io';
import { ChatSocketService } from './socket.service';

export type AuthSocket = Socket & { user?: { id: string } };

@WebSocketGateway({ cors: true })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly chatSocketService: ChatSocketService) {}

  afterInit(server: Server) {
    this.chatSocketService.setServer(server);
  }

  async handleConnection(client: AuthSocket) {
    const userId = client.user?.id || client.data?.user?.id;
    if (userId) {
      await this.chatSocketService.markUserOnline(userId);

      // gửi lại unread khi reconnect
      const unreadMap = await this.chatSocketService.getUnreadMap(userId);
      Object.entries(unreadMap).forEach(([channelId, count]) => {
        client.emit('unreadCount', { channelId, count });
      });
    } else {
      console.log(`🟢 Socket connected: ${client.id}`);
    }
  }

  async handleDisconnect(client: AuthSocket) {
    const userId = client.user?.id || client.data?.user?.id;
    if (userId) {
      await this.chatSocketService.markUserOffline(userId);
    } else {
      console.log(`🔴 Socket disconnected: ${client.id}`);
    }
  }

  @SubscribeMessage('join_channel')
  async handleJoinChannel(@MessageBody() data: { channelId: string }, @ConnectedSocket() client: AuthSocket) {
    await this.chatSocketService.joinChannel(client, data.channelId);
  }

  @SubscribeMessage('leave_channel')
  handleLeaveChannel(@MessageBody() data: { channelId: string }, @ConnectedSocket() client: AuthSocket) {
    this.chatSocketService.leaveChannel(client, data.channelId);
  }

  @SubscribeMessage('switch_channel')
  async handleSwitchChannel(
    @MessageBody() data: { oldChannelId: string; newChannelId: string },
    @ConnectedSocket() client: AuthSocket,
  ) {
    await this.chatSocketService.switchChannel(client, data.oldChannelId, data.newChannelId);
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @MessageBody() data: { channelId: string; text: string },
    @ConnectedSocket() client: AuthSocket,
  ) {
    const message = { ...data, senderId: client.user?.id };
    await this.chatSocketService.sendMessageToChannel(data.channelId, message);
  }
}
