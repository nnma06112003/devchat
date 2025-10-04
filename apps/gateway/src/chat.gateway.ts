// chat.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatSocketService } from './socket.service';

export type AuthSocket = Socket & { user?: { id: string } };

@WebSocketGateway({ cors: true })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor(private readonly chatSocketService: ChatSocketService) {}

  afterInit(server: Server) {
    this.chatSocketService.setServer(server);
  }

  // Khi client connect: đánh dấu online + bắn toàn bộ unread hiện có
  async handleConnection(client: AuthSocket) {
    const userId = client.user?.id || client.data?.user?.id;
    if (userId) {
      await this.chatSocketService.markUserOnline(userId, client.id);

      // Gửi lại unread khi reconnect / connect
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

  // ✅ FE dùng event này để đăng ký danh sách kênh muốn nghe unread
  @SubscribeMessage('register_unread_channels')
  async handleRegisterUnreadChannels(
    @MessageBody() data: { channelIds: string[] },
    @ConnectedSocket() client: AuthSocket,
  ) {
    await this.chatSocketService.registerUnreadChannels(
      client.id,
      data.channelIds || [],
    );
    console.log(
      `🔔 Socket ${client.id} đăng ký nhận unread cho kênh:`,
      data.channelIds,
    );
  }

  @SubscribeMessage('join_channel')
  async handleJoinChannel(
    @MessageBody() data: { channelId: string },
    @ConnectedSocket() client: AuthSocket,
  ) {
    await this.chatSocketService.joinChannel(client, data.channelId);
  }

  @SubscribeMessage('create_channel')
  async handleCreateChannel(
    @MessageBody() data: any,
    @ConnectedSocket() client: AuthSocket,
  ) {
    const message = { user: client?.user, ...data };
    await this.chatSocketService.createChannel(message);
  }

  @SubscribeMessage('leave_channel')
  handleLeaveChannel(
    @MessageBody() data: { channelId: string },
    @ConnectedSocket() client: AuthSocket,
  ) {
    this.chatSocketService.leaveChannel(client, data.channelId);
  }

  @SubscribeMessage('switch_channel')
  async handleSwitchChannel(
    @MessageBody() data: { oldChannelId: string; newChannelId: string },
    @ConnectedSocket() client: AuthSocket,
  ) {
    await this.chatSocketService.switchChannel(
      client,
      data.oldChannelId,
      data.newChannelId,
    );
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @MessageBody() data: any,
    @ConnectedSocket() client: AuthSocket,
  ) {
    const message = { user: client?.user, ...data };
    console.log(`📩 Data message in channel ${message.channelId}:`, message);
    await this.chatSocketService.sendMessageToChannel(message);
  }
}
