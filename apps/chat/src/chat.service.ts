
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '@myorg/entities';
import { Channel } from '@myorg/entities';
import { BaseService } from '@myorg/common';
import { RpcException } from '@nestjs/microservices';

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
  if (!channel) throw new RpcException({ msg: 'Kênh chat không tồn tại', status: 404 });
    const message = this.messageRepo.create({
      ...data,
      channel,
    });
    await this.messageRepo.save(message);
    return message;
  }



  // Lấy danh sách channel của userId
  async listChannels(user: any) {
    // Trả về danh sách các channel mà user là thành viên
    console.log(user);

    if (!user || !user.id) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 401 });
    }
    const channels = await this.channelRepo
      .createQueryBuilder('channel')
      .leftJoin('channel.users', 'user')
      .where('user.id = :userId', { userId: user?.id })
      .getMany();
    // Xóa thông tin users khỏi kết quả trả về
    return channels.map(({ users, ...rest }) => rest);
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
    user: any,
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
    const order = options?.order ?? 'ASC';

    // Kiểm tra user có trong channel không
    const channel = await this.channelRepo
      .createQueryBuilder('channel')
      .leftJoinAndSelect('channel.users', 'member')
      .leftJoin('channel.users', 'user')
      .where('channel.id = :channelId', { channelId })
      .andWhere('user.id = :userId', { userId: user.id })
      .getOne();
    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy kênh chat', status: 404 });
    }

    // Query messages bằng queryBuilder
    const msgQB = this.messageRepo
      .createQueryBuilder('message')
      .where('message.channelId = :channelId', { channelId: channel.id });

    // Cursor after
    if (options?.after) {
      const afterMsg = await this.messageRepo.findOne({
        where: { id: options.after },
        select: ['created_at'],
      });
      if (afterMsg) {
        msgQB.andWhere('message.created_at > :afterDate', { afterDate: afterMsg.created_at });
      }
    }

    // Since
    if (options?.since) {
      const sinceDate = new Date(options.since);
      if (!isNaN(sinceDate.getTime())) {
        msgQB.andWhere('message.created_at >= :sinceDate', { sinceDate });
      }
    }

    msgQB.orderBy('message.created_at', order)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await msgQB.getManyAndCount();

    // Lấy danh sách user là member của kênh (chỉ lấy id, username, email)
    const members = (channel.users || []).map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      isMine: u.id === user.id,
    }));

    // Trả về user_id cho từng tin nhắn
    const itemsWithUserId = items.map(msg => ({
      ...msg,
      user_id: (msg.sender && typeof msg.sender === 'object') ? msg.sender.id : msg.sender,
    }));

    const { users, ...channelInfo } = channel;
    return {
      channel: channelInfo,
      members,
      items: itemsWithUserId,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

}
