
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ChatService } from './chat.service';

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // Nhận message từ Gateway qua Kafka
  @MessagePattern('svc.chat.exec')
  async handleChatMessage(@Payload() payload: any) {
    switch (payload.cmd) {
      case 'sendMessage':
        return await this.chatService.sendMessage(payload.data);
      case 'listChannelsMessages':
        return await this.chatService.fetchHistory(payload.data.user,payload.data.channel_id);
      case 'listChannels':
        return await this.chatService.listChannels(payload.data.user);
      default:
        return { error: 'Unknown command' };
    }
  }
}
