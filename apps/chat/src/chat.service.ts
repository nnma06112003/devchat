
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Message, User } from '@myorg/entities';
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
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    super(messageRepo);
  }
 async createChannel(
  user: any,
  params: {
    userIds: (string | number)[],
    name?: string,
    type?: 'personal' | 'group' | 'group-private',
  },
) {
  if (!user || !user.id) {
    throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 401 });
  }

  let memberIds = [...params.userIds];

  // Không cho user.id trùng trong userIds
  memberIds = memberIds.filter((id) => id !== user.id);

  if (!memberIds.includes(user.id)) {
      memberIds.push(user.id);
    }

  // Lấy user entities
  const members = await this.check_exist_with_datas(
    User,
    { id: In(memberIds) },
    'Danh sách thành viên không hợp lệ',
  );

  if (members.length !== memberIds.length) {
    throw new RpcException({ msg: 'Thiếu thành viên kênh chat', status: 400 });
  }

  let type: 'personal' | 'group' | 'group-private' = 'group';
  if (members.length === 2) {
    type = 'personal';
  } else if (members.length > 2 && params.type === 'group-private') {
    type = 'group-private';
  } else if (members.length > 2 && params.type === 'group') {
    type = 'group';
  }

  const channel = this.channelRepo.create({
    name: params.name || (type === 'personal' ? `Personal Chat` : `Group Chat`),
    type,
    users: members,
    member_count: members.length,
  });

    const saved = await this.channelRepo.save(channel);
    // Lấy lại bản ghi channel vừa tạo (đảm bảo có id và members)
    const fullChannel = await this.channelRepo.findOne({
      where: { id: saved.id },
      relations: ['users'],
    });
   const { users, ...rest }:any = fullChannel;
    return {
      ...rest,
      members: (fullChannel?.users || []).map(u => this.remove_field_user({ ...u })),
    };
}

  // Gửi tin nhắn vào channel
  async sendMessage(user: any, data: { channelId: string; text: string; snippetId?: string }) {
    const channel = await this.check_exist_with_data(
      Channel,
      { id: data.channelId },
      'Kênh chat không tồn tại',
    );
    const sender = await this.check_exist_with_data(User, { id: user.id }, 'Người gửi không tồn tại');
    if (!channel) throw new RpcException({ msg: 'Kênh chat không tồn tại', status: 404 });
    const message = this.messageRepo.create({
      ...data,
      channel,
      sender,
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
      .leftJoinAndSelect('channel.users', 'member')
      .leftJoin('channel.users', 'user')
      .where('user.id = :userId', { userId: user?.id })
      .getMany();
    // Trả về danh sách channel, mỗi channel có mảng members đã loại bỏ trường nhạy cảm
    return channels.map(channel => ({
      ...channel,
      members: (channel.users || []).map(u => this.remove_field_user({ ...u })),
    }));
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

    async searchChatEntities(user: any, data: { key: string , type: string ,limit: number }) {
    const key = (data?.key || '').trim();
    const type = data?.type || 'all';
    const limit = data?.limit || 5;
    // Trả về user
    if (type === 'user') {
      if (!key) return { users: [], channels: { personal: [], group: [], private: [] } };
      const foundUsers = await this.userRepo.createQueryBuilder('user')
        .where('user.username LIKE :key OR user.email LIKE :key', { key: `%${key}%` })
        .limit(limit)
        .getMany();
      const users = foundUsers.map(u => this.remove_field_user({ ...u }));
      return { users, channels: { personal: [], group: [], private: [] } };
    }

    // Trả về kênh group
    if (type === 'group') {
      const foundChannels = await this.channelRepo.createQueryBuilder('channel')
        .leftJoin('channel.users', 'member')
        .where('channel.type = :type', { type: 'group' })
        .andWhere('channel.name LIKE :key', { key: `%${key}%` })
        .limit(limit)
        .getMany();
      const group = foundChannels.map(channel => {
        const isMember = channel.users?.some(u => String(u.id) === String(user.id));
        const { users, ...rest } = channel;
        return {
          ...rest,
          isMember,
        };
      });
      return { users: [], channels: { personal: [], group, private: [] } };
    }

    // Trả về kênh group-private
    if (type === 'group-private') {
      const foundChannels = await this.channelRepo.createQueryBuilder('channel')
        .leftJoin('channel.users', 'member')
        .where('channel.type = :type', { type: 'group-private' })
        .andWhere('channel.name LIKE :key', { key: `%${key}%` })
        .limit(limit)
        .getMany();
      const privateChannels = foundChannels
        .filter(channel => channel.users?.some(u => String(u.id) === String(user.id)))
        .map(channel => {
          const { users, ...rest } = channel;
          return {
            ...rest,
            isMember: true,
          };
        });
      return { users: [], channels: { personal: [], group: [], private: privateChannels } };
    }

    // Mặc định: all (như logic cũ)
    if (!key) return { users: [], channels: { personal: [], group: [], private: [] } };
    // Tìm kiếm user theo tên hoặc email
    const foundUsers = await this.userRepo.createQueryBuilder('user')
      .where('user.username LIKE :key OR user.email LIKE :key', { key: `%${key}%` })
      .limit(limit)
      .getMany();
    const users = foundUsers.map(u => this.remove_field_user({ ...u }));
    // Tìm kiếm các kênh chat có tên khớp
      const foundChannels = await this.channelRepo.createQueryBuilder('channel')
        .leftJoinAndSelect('channel.users', 'member')
        .where('channel.type = :type', { type: 'personal' })
        .andWhere('channel.name LIKE :key', { key: `%${key}%` })
        .limit(limit)
        .getMany();
    // Phân loại kênh
    const personal: any[] = [];
    const group: any[] = [];
    const privateChannels: any[] = [];
    for (const channel of foundChannels) {
      const isMember = channel.users?.some(u => String(u.id) === String(user.id));
      // Nếu là kênh personal, hiển thị tên là tên user còn lại
      if (channel.type === 'personal') {
        const otherUser = (channel.users || []).find(u => String(u.id) !== String(user.id));
        const { users, ...rest } = channel;
        personal.push({
          ...rest,
          name: otherUser ? otherUser.username : channel.name,
          isMember,
        });
      } else if (channel.type === 'group') {
        const { users, ...rest } = channel;
        group.push({
          ...rest,
          isMember,
        });
      } else if (channel.type === 'group-private') {
        // Chỉ hiển thị nếu user là member
        if (isMember) {
          const { users, ...rest } = channel;
          privateChannels.push({
            ...rest,
            isMember,
          });
        }
      }
    }
    return {
      users,
      channels: {
        personal,
        group,
        private: privateChannels,
      },
    };
  }

}
