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

  // Nhận tin nhắn từ client qua socket
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    // Gửi message tới ChatService qua Kafka
    const result = await this.gw.exec('chat', 'sendMessage', data);
    // Emit lại kết quả cho client (hoặc broadcast cho các client khác)
    client.emit('messageSent', result);
    // Hoặc: this.server.emit('newMessage', result);
  }
}