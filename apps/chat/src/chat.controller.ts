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
        return await this.chatService.sendMessage(
          payload.data.user,
          payload.data,
          payload.data.presignedAttachments,
        );
      case 'createChannel':
        return await this.chatService.createChannel(
          payload.data.user,
          payload.data,
        );
      case 'listChannelsMessages':
        return await this.chatService.fetchHistory(
          payload.data.user,
          payload.data.channel_id,
          payload.data,
        );
      case 'listChannels':
        return await this.chatService.listChannels(payload.data.user);
      case 'searchChatEntities':
        return await this.chatService.searchChatEntities(
          payload.data.user,
          payload.data,
        );
      case 'joinChannel':
        return await this.chatService.joinChannel(
          payload.data.user,
          payload.data,
        );

      case 'addRepositoriesToChannel':
        return await this.chatService.addRepositoriesToChannel(
          payload.data.user.id,
          payload.data.channel_id,
          payload.data.repository_ids,
        );

      case 'listRepositoriesByChannel':
        return await this.chatService.listRepositoriesByChannel(
          payload.data.user.id,
          payload.data.channel_id,
          payload.data,
        );

      case 'removeRepositoriesFromChannel':
        return await this.chatService.removeRepositoryFromChannel(
          payload.data.user.id,
          payload.data.channel_id,
          payload.data.repository_id,
        );

      case 'addMembersToChannel':
        return await this.chatService.addMembersToChannel(
          payload.data.user.id,
          payload.data.channel_id,
          payload.data.member_ids,
        );
      case 'removeMembersFromChannel':
        return await this.chatService.removeMembersFromChannel(
          payload.data.user.id,
          payload.data.channel_id,
          payload.data.member_ids,
        );
      case 'listNonMembers':
        return await this.chatService.listNonMembers(
          payload.data.channel_id,
          payload.data.username,
          payload.data.limit,
          payload.data.cursor,
        );
      case 'searchMessages':
        return await this.chatService.searchMessages(
          payload.data.userId,
          payload.data,
        );
      default:
        return { error: 'Unknown command' };
    }
  }
}
