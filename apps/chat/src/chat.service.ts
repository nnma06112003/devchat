
import { Injectable } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './entities/message.entity';
import { Channel } from './entities/channel.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
  ) {}

  // Gửi tin nhắn vào channel
  async sendMessage(data: { channelId: string; senderId: string; text: string; snippetId?: string }) {
    const channel = await this.channelRepo.findOne({ where: { id: data.channelId } });
    if (!channel) throw new Error('Channel not found');
    const message = this.messageRepo.create({
      ...data,
      channel,
    });
    await this.messageRepo.save(message);
    return message;
  }

  // Lấy tin nhắn của channel
  async listMessages(channelId: string) {
    return this.messageRepo.find({
      where: { channel: { id: channelId } },
      relations: ['channel'],
      order: { createdAt: 'ASC' },
    });
  }

  // Lấy danh sách channel của userId
  async listChannels(userId: string) {
    // Nếu dùng Postgres và members là simple-array, dùng query builder:
    return this.channelRepo.createQueryBuilder('channel')
      .leftJoinAndSelect('channel.messages', 'message')
      .where(':userId = ANY(channel.members)', { userId })
      .getMany();
  }
}
