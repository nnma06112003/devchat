import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Message, User } from '@myorg/entities';
import { Channel } from '@myorg/entities';
import { BaseService } from '@myorg/common';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class ChatService extends BaseService<Message | Channel> {
  /**
   * Tham gia kênh chat
   * @param user user hiện tại
   * @param data { id: string, type: 'group' | 'personal' }
   */
  
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


  async joinChannel(user: any, data: { id: string, type: string }) {
    if (!user || !user.id) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 401 });
    }
    if (!data?.id || !data?.type) {
      throw new RpcException({ msg: 'Thiếu thông tin kênh hoặc loại kênh', status: 400 });
    }
    if (data.type === 'group') {
      // Tìm kênh group
      const channel = await this.channelRepo.findOne({
        where: { id: data.id, type: 'group' },
        relations: ['users'],
      });
      if (!channel) {
        throw new RpcException({ msg: 'Không tìm thấy kênh công khai', status: 404 });
      }
      // Kiểm tra user đã là thành viên chưa
      const isMember = channel.users.some(u => String(u.id) === String(user.id));
      if (isMember) {
         return {
          msg: 'Bạn đang là thành viên của kênh này',
          channelId: data.id,
        };
      }
      // Thêm user vào kênh
      channel.users.push(user);
      channel.member_count = channel.users.length;
      await this.channelRepo.save(channel);
      return {
        msg: 'Tham gia kênh thành công',
        channelId: channel.id,
      };
    } else if (data.type === 'personal') {
      // Tìm user còn lại
      const otherUser = await this.userRepo.findOne({ where: { id: data.id } });
      if (!otherUser) {
        throw new RpcException({ msg: 'Không tìm thấy người dùng còn lại', status: 404 });
      }
      // Kiểm tra đã có kênh personal giữa 2 user chưa
      const existChannel = await this.channelRepo
        .createQueryBuilder('channel')
        .leftJoinAndSelect('channel.users', 'member')
        .where('channel.type = :type', { type: 'personal' })
        .andWhere('member.id IN (:...ids)', { ids: [user.id, otherUser.id] })
        .getMany();
      // Lọc kênh có đúng 2 thành viên là 2 user này
      const found = existChannel.find(c => c.users.length === 2 && c.users.some(u => String(u.id) === String(user.id)) && c.users.some(u => String(u.id) === String(otherUser.id)));
      if (found) {
         return {
          msg: 'Bạn đã nhắn tin với người này',
          channelId: found.id,
      };
      }
      // Tạo kênh mới
      const channel = this.channelRepo.create({
        name: 'Personal Chat',
        type: 'personal',
        users: [user, otherUser],
        member_count: 2,
      });
      const saved = await this.channelRepo.save(channel);
      return {
        msg: 'Hai bạn có thể nhắn tin với nhau',
        channelId: saved.id,
      };
    } else {
      throw new RpcException({ msg: 'Kênh không hợp lệ', status: 400 });
    }
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
   
const owner = await this.check_exist_with_data(
    User,
    { id: user.id },
    'Tài khoản không hợp lệ',
  );

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
  owner: (type === 'group' || type === 'group-private') ? owner : undefined,
  });

    const saved = await this.channelRepo.save(channel);
    // Lấy lại bản ghi channel vừa tạo (đảm bảo có id và members)
    const fullChannel :any= await this.channelRepo.findOne({
      where: { id: saved.id },
      relations: ['users'],
    });
   

    let isActive = true;
      let channelName = fullChannel.name;
      if (fullChannel.type === 'personal') {
        const msgCount = await this.messageRepo.count({ where: { channel: { id: fullChannel.id } } });
        isActive = msgCount > 0;
        const otherUser = (fullChannel.users || []).find((u:any) => String(u.id) !== String(user.id));
        if (otherUser && otherUser.username) {
          channelName = otherUser.username;
        }
      }
   const { users, name, ...rest }: any = fullChannel;
    return {
      ...rest,
      name: channelName,
      isActive,
      members: (fullChannel?.users || []).map((u:any) => this.remove_field_user({ ...u })),
    };
}

  // Gửi tin nhắn vào channel
async sendMessage(user: any, data: { channelId: string; text: string; send_at: any }) {
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
    send_at: data.send_at,
  });
  await this.messageRepo.save(message);
  const msgCount = await this.messageRepo.count({ where: { channel: { id: channel.id } } });

  // Đếm số message trong channel

  if (msgCount === 1) {
    // Đây là message đầu tiên trong channel
    return {
      ...message,
      channel: {
        id: channel.id,
        type: channel.type,
        member_count: channel.member_count,
        members: (channel.users || []).map(u => this.remove_field_user({ ...u })),
        created_at: channel.created_at,
        updated_at: channel.updated_at,
        isActive: true,
      },
    };
  }

  // Nếu không phải message đầu tiên → chỉ trả về message
  return message;
}




  // Lấy danh sách channel của userId
  async listChannels(user: any) {
    // Trả về danh sách các channel mà user là thành viên

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
    const result = [];
    for (const channel of channels) {
      let isActive = true;
      let channelName = channel.name;
      if (channel.type === 'personal') {
        const msgCount = await this.messageRepo.count({ where: { channel: { id: channel.id } } });
        isActive = msgCount > 0;
        const otherUser = (channel.users || []).find(u => String(u.id) !== String(user.id));
        if (otherUser && otherUser.username) {
          channelName = otherUser.username;
        }
      }
      // group và group-private luôn isActive = true
      result.push({
        id: channel.id,
        name: channelName,
        type: channel.type,
        member_count: channel.member_count,
        members: (channel.users || []).map(u => this.remove_field_user({ ...u })),
        created_at: channel.created_at,
        updated_at: channel.updated_at,
        isActive,
        // members: (channel.users || []).map(u => this.remove_field_user({ ...u })),
      });
    }
    return result;
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
      .leftJoinAndSelect('channel.owner', 'owner')
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
      .leftJoinAndSelect('message.sender', 'sender')
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
      isOwner: channel.owner && u.id === channel.owner.id,
    })); 

    // Trả về user_id và thông tin sender đã xử lý cho từng tin nhắn
      const itemsWithUserId = items.map(msg => {
        let senderInfo = undefined;
        let isMine = false;
        if (msg.sender) {
          if (typeof msg.sender === 'object') {
            senderInfo = this.remove_field_user({ ...msg.sender });
            isMine = String(msg.sender.id) === String(user.id);
          } else {
            // Nếu sender là id, cần lấy thông tin user
            const senderObj = (channel.users || []).find(u => String(u.id) === String(msg.sender));
            senderInfo = senderObj ? this.remove_field_user({ ...senderObj }) : undefined;
            isMine = String(msg.sender) === String(user.id);
          }
        }
        return {
          ...msg,
          sender: senderInfo,
          isMine,
        };
      });

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
  async searchChatEntities(
    user: any,
    data: { key: string; type: 'user' | 'group' | 'group-private' | 'personal' | 'all'; limit: number },
  ) {
    const key = (data?.key || '').trim().toLowerCase();
    const type = data?.type || 'all';
    const limit = data?.limit || 5;

    if (!key) {
      return { users: [], channels: { personal: [], group: [], private: [] } };
    }

    // ---- Helper queries ----
    const searchUsers = async () => {
      const users = await this.userRepo
        .createQueryBuilder('u')
        .select(['u.id', 'u.username', 'u.email'])
        .where('(LOWER(u.username) LIKE :key OR LOWER(u.email) LIKE :key) AND u.id != :uid', { key: `%${key}%`, uid: user.id })
        .take(limit)
        .getMany();
      return users.map(u => this.remove_field_user({ ...u }));
    };

    const searchGroupChannels = async () => {
      const channels:any = await this.channelRepo
        .createQueryBuilder('c')
        .select(['c.id', 'c.name', 'c.type'])
        .where('c.type = :type', { type: 'group' })
        .andWhere('LOWER(c.name) LIKE :key', { key: `%${key}%` })
        .take(limit)
        .getMany();

      // check membership (chỉ query id thôi cho nhẹ)
      const memberIds = await this.channelRepo
        .createQueryBuilder('c')
        .innerJoin('c.users', 'u', 'u.id = :uid', { uid: user.id })
        .select('c.id', 'id')
        .where('c.type = :type', { type: 'group' })
        .getRawMany();

      const memberSet = new Set(memberIds.map(m => m.id));
      return channels.map((ch:any) => ({ ...ch, isMember: memberSet.has(ch.id) }));
    };

    const searchPrivateChannels = async () => {
      const channels = await this.channelRepo
        .createQueryBuilder('c')
        .innerJoin('c.users', 'u', 'u.id = :uid', { uid: user.id }) // chỉ lấy kênh user là thành viên
        .select(['c.id', 'c.name', 'c.type'])
        .where('c.type = :type', { type: 'group-private' })
        .andWhere('LOWER(c.name) LIKE :key', { key: `%${key}%` })
        .take(limit)
        .getMany();

      return channels.map(ch => ({ ...ch, isMember: true }));
    };

const searchPersonalChannels = async () => {
  const channels = await this.channelRepo
    .createQueryBuilder('c')
    .innerJoin('c.users', 'u') // user hiện tại
    .innerJoin('c.users', 'ou') // other user
    .select(['c.id', 'c.type', 'ou.username']) // chỉ cần id, type, username
    .where('c.type = :type', { type: 'personal' })
    .andWhere('u.id = :uid', { uid: user.id })
    .andWhere('ou.id != :uid', { uid: user.id })
    .andWhere('LOWER(ou.username) LIKE :key', { key: `%${key}%` })
    .take(limit)
    .getRawMany(); // dùng rawMany cho tiện mapping

  return channels.map(ch => ({
    id: ch.c_id,
    type: ch.c_type,
    name: ch.ou_username, // đặt tên kênh = username của member còn lại
    isMember: true,
  }));
};


    // ---- Main logic ----
    const result:any = { users: [], channels: { personal: [], group: [], private: [] } };

    if (type === 'user') {
      result.users = await searchUsers();
    } else if (type === 'group') {
      result.channels.group = await searchGroupChannels();
    } else if (type === 'group-private') {
      result.channels.private = await searchPrivateChannels();
    } else if (type === 'personal') {
      result.channels.personal = await searchPersonalChannels();
    } else {
      // all
      [result.users, result.channels.group, result.channels.private, result.channels.personal] =
        await Promise.all([
          searchUsers(),
          searchGroupChannels(),
          searchPrivateChannels(),
          searchPersonalChannels(),
        ]);
    }

    return result;
  }


}
