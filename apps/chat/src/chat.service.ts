
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

  /**
   * Lấy lịch sử tin nhắn của một channel với phân trang và filter.
   * - page/pageSize: phân trang dựa trên offset
   * - after: id của tin nhắn cuối (cursor) -> trả các tin nhắn sau tin nhắn này (by createdAt)
   * - since: timestamp ISO/string/Date -> trả các tin nhắn từ lúc này trở đi
   * - order: 'ASC' | 'DESC' (mặc định 'ASC')
   * Trả về { items, total, page, pageSize, hasMore }
   */
  async fetchHistory(
    channelId: string,
    options?: {
      page?: number;
      pageSize?: number;
      after?: string; // messageId cursor
      since?: string | Date;
      order?: 'ASC' | 'DESC';
    },
  ) {
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, options?.pageSize ?? 50));

    const qb = this.messageRepo.createQueryBuilder('message')
      .leftJoinAndSelect('message.channel', 'channel')
      .where('channel.id = :channelId', { channelId });

    // Filter by 'after' cursor (message id). We'll resolve the timestamp of that message
    if (options?.after) {
      const afterMsg = await this.messageRepo.findOne({ where: { id: options.after } });
      if (afterMsg) {
        qb.andWhere('message.createdAt > :afterDate', { afterDate: afterMsg.createdAt.toISOString() });
      }
    }

    // Filter by since timestamp
    if (options?.since) {
      const sinceDate = options.since instanceof Date ? options.since : new Date(options.since);
      if (!isNaN(sinceDate.getTime())) {
        qb.andWhere('message.createdAt >= :since', { since: sinceDate.toISOString() });
      }
    }

    const order: 'ASC' | 'DESC' = options?.order ?? 'ASC';
    qb.orderBy('message.createdAt', order)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }
}
