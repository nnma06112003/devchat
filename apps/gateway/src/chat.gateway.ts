import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GatewayService } from './gateway.service';

@WebSocketGateway({ cors: true })
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly gw: GatewayService) {}

  // Client join vào phòng chat theo channelId
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { channelId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.channelId); // socket join vào room
    console.log(`User ${data.userId} joined room ${data.channelId}`);

    // Báo lại cho client là đã join thành công
    client.emit('joinedRoom', { channelId: data.channelId });
  }

  // Nhận tin nhắn từ client
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() data: { channelId: string; senderId: string; text: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Gửi message tới service qua Kafka
    const result = await this.gw.exec('chat', 'sendMessage', data);

    // Emit tin nhắn mới cho tất cả client trong cùng phòng channelId
    this.server.to(data.channelId).emit('receiveMessage', result);
  }
}
