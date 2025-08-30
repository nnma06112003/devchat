
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '@myorg/entities';
import { Channel } from '@myorg/entities';
import { BaseService } from '@myorg/common';

@Injectable()
export class ChatService extends BaseService<Message | Channel> {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
  ) {
    super(messageRepo);
  }

  // Gửi tin nhắn vào channel
  async sendMessage(data: { channelId: string; senderId: string; text: string; snippetId?: string }) {
    const channel = await this.check_exist_with_data(
      Channel,
      { id: data.channelId },
      'Kênh chat không tồn tại',
    );
    if (!channel) throw new Error('Channel not found');
    const message = this.messageRepo.create({
      ...data,
      channel,
    });
    await this.messageRepo.save(message);
    return message;
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
   * - after: id của tin nhắn cuối (cursor) -> trả các tin nhắn sau tin nhắn này (by created_at)
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

  // Kiểm tra kênh tồn tại
  const channel:any = await this.check_exist_with_data(
    Channel,
    { id: channelId },
    'Kênh chat không tồn tại',
  );

  const where: any = { channel: { id: channel.id } };

  // Xử lý cursor "after"
  if (options?.after) {
    const afterMsg = await this.messageRepo.findOne({
      where: { id: options.after },
      select: ['created_at'],
    });
    if (afterMsg) {
      where.created_at = { ...(where.created_at ?? {}), $gt: afterMsg.created_at };
    }
  }

  // Xử lý "since"
  if (options?.since) {
    const sinceDate = new Date(options.since);
    if (!isNaN(sinceDate.getTime())) {
      where.created_at = { ...(where.created_at ?? {}), $gte: sinceDate };
    }
  }

  const order = options?.order ?? 'ASC';

  const [items, total] = await this.messageRepo.findAndCount({
    where,
    relations: { channel: true },
    order: { created_at: order },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}

}
