import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Attachment, Message, User } from '@myorg/entities';
import { Channel } from '@myorg/entities';
import { BaseService } from '@myorg/common';
import { RpcException } from '@nestjs/microservices';
import { Repository as RepoEntity } from '@myorg/entities'; // Đảm bảo import đúng entity Repository

@Injectable()
export class ChatService extends BaseService<Message> {
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
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
  ) {
    super(messageRepo);
  }

  async joinChannel(user: any, data: { id: string; type: string }) {
    if (!user || !user.id) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 401 });
    }
    if (!data?.id || !data?.type) {
      throw new RpcException({
        msg: 'Thiếu thông tin kênh hoặc loại kênh',
        status: 400,
      });
    }
    if (data.type === 'group') {
      // Tìm kênh group
      const channel = await this.channelRepo.findOne({
        where: { id: data.id, type: 'group' },
        relations: ['users'],
      });
      if (!channel) {
        throw new RpcException({
          msg: 'Không tìm thấy kênh công khai',
          status: 404,
        });
      }
      // Kiểm tra user đã là thành viên chưa
      const isMember = channel.users.some(
        (u) => String(u.id) === String(user.id),
      );
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
        throw new RpcException({
          msg: 'Không tìm thấy người dùng còn lại',
          status: 404,
        });
      }
      // Kiểm tra đã có kênh personal giữa 2 user chưa
      const existChannel = await this.channelRepo
        .createQueryBuilder('channel')
        .leftJoinAndSelect('channel.users', 'member')
        .where('channel.type = :type', { type: 'personal' })
        .andWhere('member.id IN (:...ids)', { ids: [user.id, otherUser.id] })
        .getMany();
      // Lọc kênh có đúng 2 thành viên là 2 user này
      const found = existChannel.find(
        (c) =>
          c.users.length === 2 &&
          c.users.some((u) => String(u.id) === String(user.id)) &&
          c.users.some((u) => String(u.id) === String(otherUser.id)),
      );
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
      userIds: (string | number)[];
      name?: string;
      type?: 'personal' | 'group' | 'group-private';
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
      throw new RpcException({
        msg: 'Thiếu thành viên kênh chat',
        status: 400,
      });
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
      name:
        params.name || (type === 'personal' ? `Personal Chat` : `Group Chat`),
      type,
      users: members,
      member_count: members.length,
      owner: type === 'group' || type === 'group-private' ? owner : undefined,
    });

    const saved = await this.channelRepo.save(channel);
    // Lấy lại bản ghi channel vừa tạo (đảm bảo có id và members)
    const fullChannel: any = await this.channelRepo.findOne({
      where: { id: saved.id },
      relations: ['users'],
    });

    let isActive = true;
    let channelName = fullChannel.name;
    if (fullChannel.type === 'personal') {
      const msgCount = await this.messageRepo.count({
        where: { channel: { id: fullChannel.id } },
      });
      isActive = msgCount > 0;
      const otherUser = (fullChannel.users || []).find(
        (u: any) => String(u.id) !== String(user.id),
      );
      if (otherUser && otherUser.username) {
        channelName = otherUser.username;
      }
    }
    const { users, name, ...rest }: any = fullChannel;
    return {
      ...rest,
      name: channelName,
      isActive,
      members: (fullChannel?.users || []).map((u: any) =>
        this.remove_field_user({ ...u }),
      ),
    };
  }

  // Gửi tin nhắn vào channel
  async sendMessage(
    user: any,
    data: { channelId: string; text: string; send_at: any; type?: string; json_data?: any },
    attachments?: any[],
  ) {
    console.log(`🔍 [DEBUG] Chat service sendMessage called with:`, {
      channelId: data.channelId,
      type: data.type,
      hasJsonData: !!data.json_data,
      jsonDataType: typeof data.json_data,
      text: data.text?.substring(0, 100) + '...'
    });

    const channel = await this.check_exist_with_data(
      Channel,
      { id: data.channelId },
      'Kênh chat không tồn tại',
    );
    const sender = await this.check_exist_with_data(
      User,
      { id: user.id },
      'Người gửi không tồn tại',
    );
    if (!channel)
      throw new RpcException({ msg: 'Kênh chat không tồn tại', status: 404 });

    const messageData = {
      ...data,
      channel,
      sender,
      send_at: data.send_at,
      type: data.type || 'message',
      json_data: data.json_data || null,
    };

    console.log(`🔍 [DEBUG] Creating message with data:`, {
      type: messageData.type,
      hasJsonData: !!messageData.json_data,
      text: messageData.text?.substring(0, 50) + '...'
    });

    const message = this.messageRepo.create(messageData);

    await this.messageRepo.save(message);

    console.log(`🔍 [DEBUG] Message saved to database:`, {
      id: message.id,
      type: message.type,
      hasJsonData: !!message.json_data,
      text: message.text?.substring(0, 50) + '...'
    });

    if (attachments && attachments.length > 0) {
      message.attachments = this.attachmentRepo.create(
        attachments.map((a) => ({
          ...a,
          message,
        })),
      );
    }

    await this.messageRepo.save(message);

    const msgCount = await this.messageRepo.count({
      where: { channel: { id: channel.id } },
    });

    // Đếm số message trong channel

    if (msgCount === 1) {
      // Đây là message đầu tiên trong channel
      return {
        ...message,
        channel: {
          id: channel.id,
          type: channel.type,
          member_count: channel.member_count,
          members: (channel.users || []).map((u) =>
            this.remove_field_user({ ...u }),
          ),
          created_at: channel.created_at,
          updated_at: channel.updated_at,
          isActive: true,
        },
      };
    }

    // Nếu không phải message đầu tiên → chỉ trả về message
    console.log(`🔍 [DEBUG] Returning message:`, {
      id: message.id,
      type: message.type,
      hasJsonData: !!message.json_data,
      text: message.text?.substring(0, 50) + '...'
    });
    
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
        const msgCount = await this.messageRepo.count({
          where: { channel: { id: channel.id } },
        });
        isActive = msgCount > 0;
        const otherUser = (channel.users || []).find(
          (u) => String(u.id) !== String(user.id),
        );
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
        members: (channel.users || []).map((u) =>
          this.remove_field_user({ ...u }),
        ),
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
  // Gợi ý index để truy vấn nhanh:
  // CREATE INDEX IF NOT EXISTS ix_msg_channel_time_id ON message(channel_id, send_at DESC, id DESC);

  async fetchHistory(
    user: any,
    channelId: string | number,
    options?: {
      pageSize?: number; // mặc định 50
      after?: string; // messageId cursor: lấy MỚI HƠN anchor (dùng cho live catch-up)
      before?: string; // messageId cursor: lấy CŨ HƠN anchor (scroll lên: trang 2,3,...)
      since?: string | Date; // lọc từ thời điểm này trở đi (nếu cần)
      latest?: boolean; // chỉ lấy 1 tin mới nhất
    },
  ) {
    const pageSize = Math.min(200, Math.max(1, options?.pageSize ?? 50));

    // 1) Kiểm tra quyền truy cập kênh
    const isMember = await this.channelRepo
      .createQueryBuilder('c')
      .innerJoin('c.users', 'u', 'u.id = :userId', { userId: user.id })
      .where('c.id = :channelId', { channelId })
      .getExists();

    if (!isMember) {
      throw new RpcException({
        msg: 'Không tìm thấy kênh chat hoặc bạn không có quyền',
        status: 404,
      });
    }

    // 2) Lấy channel + owner + users (để build members/sender)
    const channel = await this.channelRepo
      .createQueryBuilder('channel')
      .leftJoinAndSelect('channel.owner', 'owner')
      .leftJoinAndSelect('channel.users', 'member')
      .where('channel.id = :channelId', { channelId })
      .getOne();

    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy kênh chat', status: 404 });
    }

    // Helper: lấy anchor (id + send_at)
    const getAnchor = async (id?: string) => {
      if (!id) return undefined;
      return this.messageRepo.findOne({
        where: { id },
        select: ['id', 'send_at'],
      });
    };

    const anchorBefore = await getAnchor(options?.before);
    const anchorAfter = !options?.before
      ? await getAnchor(options?.after)
      : undefined;

    // 3) Base QB
    const baseQB = this.messageRepo
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.attachments', 'attachment')
      // nếu FK là snake_case thì đổi thành 'message.channel_id'
      .where('message.channelId = :channelId', { channelId });

    if (options?.since) {
      const sinceDate = new Date(options.since);
      if (!isNaN(sinceDate.getTime())) {
        baseQB.andWhere('message.send_at >= :sinceDate', { sinceDate });
      }
    }

    let rows: any[] = [];
    let hasMoreOlder = false;
    let hasMoreNewer = false;

    if (options?.latest) {
      // chỉ lấy 1 tin mới nhất
      rows = await baseQB
        .orderBy('message.send_at', 'DESC')
        .addOrderBy('message.id', 'DESC')
        .take(1)
        .getMany();

      // Trả về 1 phần tử, không đảo, nhưng để thống nhất UI (cũ→mới), ta đảo để newest là cuối cùng
      rows = rows.reverse();
    } else if (anchorBefore) {
      // TRANG CŨ HƠN (trang 2,3...) — lấy cũ hơn anchor, ORDER DESC để chọn đúng cửa sổ mới→cũ
      const r = await baseQB
        .andWhere(
          `(message.send_at < :anchorTime)
         OR (message.send_at = :anchorTime AND message.id < :anchorId)`,
          { anchorTime: anchorBefore.send_at, anchorId: anchorBefore.id },
        )
        .orderBy('message.send_at', 'DESC')
        .addOrderBy('message.id', 'DESC')
        .take(pageSize + 1)
        .getMany();

      hasMoreOlder = r.length > pageSize;
      rows = r.slice(0, pageSize);

      // Quan trọng: đảo sang ASC (cũ→mới) để PHẦN TỬ CUỐI = MỚI NHẤT CỦA TRANG
      rows = rows.reverse();

      // Nếu còn phần tử thứ (pageSize+1) => vẫn còn cũ hơn
      // hasMoreNewer ở nhánh này không cần set (cuộn xuống thường không dùng), nhưng có thể tính nếu muốn
    } else if (anchorAfter) {
      // LẤY MỚI HƠN ANCHOR (bắt kịp hiện tại): ORDER ASC để ổn định, rồi giữ luôn ASC (cũ→mới)
      const rAsc = await baseQB
        .andWhere(
          `(message.send_at > :anchorTime)
         OR (message.send_at = :anchorTime AND message.id > :anchorId)`,
          { anchorTime: anchorAfter.send_at, anchorId: anchorAfter.id },
        )
        .orderBy('message.send_at', 'ASC')
        .addOrderBy('message.id', 'ASC')
        .take(pageSize + 1)
        .getMany();

      hasMoreNewer = rAsc.length > pageSize;
      rows = rAsc.slice(0, pageSize);

      // Giữ nguyên ASC (cũ→mới) để phần tử cuối cùng là mới nhất của trang này
    } else {
      // TRANG ĐẦU (initial): chọn 50 tin mới nhất theo DESC rồi đảo sang ASC để newest nằm CUỐI
      const r = await baseQB
        .orderBy('message.send_at', 'DESC')
        .addOrderBy('message.id', 'DESC')
        .take(pageSize + 1)
        .getMany();

      hasMoreOlder = r.length > pageSize; // còn cũ hơn (để kéo trang 2)
      rows = r.slice(0, pageSize).reverse(); // đảo sang ASC (cũ→mới)
    }

    // 4) Chuẩn hóa sender & flags
    const items = rows.map((msg) => {
      let senderInfo: any = undefined;
      let isMine = false;

      if (msg.sender) {
        if (typeof msg.sender === 'object') {
          senderInfo = this.remove_field_user({ ...msg.sender });
          isMine = String(msg.sender.id) === String(user.id);
        } else {
          const senderObj = (channel.users || []).find(
            (u) => String(u.id) === String(msg.sender),
          );
          senderInfo = senderObj
            ? this.remove_field_user({ ...senderObj })
            : undefined;
          isMine = String(msg.sender) === String(user.id);
        }
      }

      const attachments = (msg.attachments || []).map((att: any) => ({
        id: att.id,
        filename: att.filename,
        fileUrl: att.fileUrl,
        mimeType: att.mimeType,
        fileSize: att.fileSize,
        key: att.key,
      }));

      return {
        ...msg,
        channelId: msg.channelId || (msg.channel ? msg.channel.id : null),
        sender: senderInfo,
        attachments,
        isMine,
      };
    });

    // 5) Cursors (DANH SÁCH ĐANG Ở THỨ TỰ ASC: CŨ → MỚI)
    const oldest = items[0]; // phần tử đầu (cũ nhất của trang)
    const newest = items[items.length - 1]; // phần tử cuối (mới nhất của trang) — đúng yêu cầu

    // Scroll lên (trang cũ hơn): dùng 'before' = id của phần tử ĐẦU (oldest)
    const nextBefore = oldest?.id ?? null;

    // Bắt kịp hiện tại (nếu có trang mới hơn): dùng 'after' = id của phần tử CUỐI (newest)
    const nextAfter = newest?.id ?? null;

    // 6) Members tối giản
    const members = (channel.users || []).map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      isMine: String(u.id) === String(user.id),
      isOwner: channel.owner && String(u.id) === String(channel.owner.id),
    }));

    const { users, ...channelInfo } = channel;

    return {
      channel: channelInfo,
      members,
      items, // THỨ TỰ ASC (cũ → mới) — phần tử cuối là mới nhất
      total: null,
      page: null,
      pageSize,
      hasMoreOlder, // còn trang cũ hơn (để kéo tiếp 901→950, …)
      hasMoreNewer, // còn trang mới hơn (nếu dùng nhánh after)
      cursors: {
        before: nextBefore, // truyền vào options.before để lấy CŨ HƠN
        after: nextAfter, // truyền vào options.after  để lấy MỚI HƠN
      },
    };
  }

  async searchChatEntities(
    user: any,
    data: {
      key: string;
      type: 'user' | 'group' | 'group-private' | 'personal' | 'all';
      limit: number;
    },
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
        .where(
          '(LOWER(u.username) LIKE :key OR LOWER(u.email) LIKE :key) AND u.id != :uid',
          { key: `%${key}%`, uid: user.id },
        )
        .take(limit)
        .getMany();
      return users.map((u) => this.remove_field_user({ ...u }));
    };

    const searchGroupChannels = async () => {
      const channels: any = await this.channelRepo
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

      const memberSet = new Set(memberIds.map((m) => m.id));
      return channels.map((ch: any) => ({
        ...ch,
        isMember: memberSet.has(ch.id),
      }));
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

      return channels.map((ch) => ({ ...ch, isMember: true }));
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

      return channels.map((ch) => ({
        id: ch.c_id,
        type: ch.c_type,
        name: ch.ou_username, // đặt tên kênh = username của member còn lại
        isMember: true,
      }));
    };

    // ---- Main logic ----
    const result: any = {
      users: [],
      channels: { personal: [], group: [], private: [] },
    };

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
      [
        result.users,
        result.channels.group,
        result.channels.private,
        result.channels.personal,
      ] = await Promise.all([
        searchUsers(),
        searchGroupChannels(),
        searchPrivateChannels(),
        searchPersonalChannels(),
      ]);
    }

    return result;
  }

  async addRepositoriesToChannel(
    userId: string | number,
    channelId: string | number,
    repoIds: string[]
  ) {
    // 1. Kiểm tra danh sách repo_id hợp lệ
    if (!Array.isArray(repoIds) || repoIds.length === 0) {
      throw new RpcException({ msg: 'Danh sách Repository không hợp lệ', status: 400 });
    }

    // 2. Kiểm tra user tồn tại và đã có installation_id
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy user', status: 404 });
    }
    if (!user.github_installation_id) {
      throw new RpcException({ msg: 'User chưa cài đặt GitHub App', status: 400 });
    }

    // 3. Kiểm tra channel tồn tại và user là thành viên
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users'],
    });
    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy channel', status: 404 });
    }
    const isMember = channel.users.some((u) => String(u.id) === String(user.id));
    if (!isMember) {
      throw new RpcException({ msg: 'Bạn không phải thành viên của kênh này', status: 403 });
    }

    // 4. Kiểm tra repo đã liên kết với channel chưa
    const repoRepo = this.attachmentRepo.manager.getRepository(RepoEntity);
    for (const rpid of repoIds) {
      const repo = await repoRepo.findOne({
        where: { repo_id: rpid, user: { id: user.id } },
        relations: ['channels'],
      });
      if (repo && repo.channels?.some((c) => String(c.id) === String(channel.id))) {
        throw new RpcException({ msg: `Không được thêm trùng Repository`, status: 400 });
      }
    }

    // 5. Thêm các repo vào DB (nếu chưa có), liên kết với user và channel
    const repos: RepoEntity[] = [];
    for (const rpid of repoIds) {
      let repo = await repoRepo.findOne({ where: { repo_id: rpid, user: { id: user.id } }, relations: ['channels'] });
      if (!repo) {
        repo = repoRepo.create({ repo_id: rpid, user });
        await repoRepo.save(repo);
      }
      // Liên kết repo với channel nếu chưa có
      if (!repo.channels) repo.channels = [];
      const alreadyLinked = repo.channels.some((c) => String(c.id) === String(channel.id));
      if (!alreadyLinked) {
        repo.channels.push(channel);
        await repoRepo.save(repo);
      }
      repos.push(repo);
    }

    return {
      repositories: repos.map((r) => ({
        id: r.id,
        repo_id: r.repo_id,
      })),
    };
  }

  async listRepositoriesByChannel(
    userId: string | number,
    channelId: string | number,
    data: {
      order?: 'asc' | 'desc',
      limit?: number,
      page?: number
    }
  ) {
    // Set default values
    const order = data.order ?? 'asc';
    const limit = data.limit ?? 20;
    const page = data.page ?? 1;

    // 1. Kiểm tra channel tồn tại và user là thành viên
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users', 'repositories', 'repositories.user'],
    });
    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy channel', status: 404 });
    }
    const isMember = channel.users.some((u) => String(u.id) === String(userId));
    if (!isMember) {
      throw new RpcException({ msg: 'Bạn không phải thành viên của kênh này', status: 403 });
    }

    // 2. Lấy danh sách repo, sort theo id
    let repos = [...(channel.repositories || [])];
    repos.sort((a, b) =>
      order === 'asc'
        ? Number(a.id) - Number(b.id)
        : Number(b.id) - Number(a.id)
    );

    // 3. Phân trang
    const total = repos.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const pagedRepos = repos.slice(start, end);

    // 4. Trả về thông tin repo cần thiết
    return {
      total,
      page,
      limit,
      items: pagedRepos.map((repo) => ({
        repo_id: repo.repo_id,
        user_id: repo.user?.id || null,
        repo_installation : repo.user?.github_installation_id || null
      })),
    };
  }

  async removeRepositoryFromChannel(
    userId: string | number,
    channelId: string | number,
    repoId: string | number
  ) {
    // 1. Kiểm tra user tồn tại
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new RpcException({ msg: 'Không tìm thấy user', status: 404 });

    // 2. Kiểm tra channel tồn tại và user là thành viên
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users', 'repositories', 'owner'],
    });
    if (!channel) throw new RpcException({ msg: 'Không tìm thấy channel', status: 404 });
    const isMember = channel.users.some((u) => String(u.id) === String(userId));
    if (!isMember) throw new RpcException({ msg: 'Bạn không phải thành viên của kênh này', status: 403 });

    // 3. Kiểm tra repo tồn tại trong channel
    const repoRepo = this.attachmentRepo.manager.getRepository(RepoEntity);
    const repo = await repoRepo.findOne({
      where: { repo_id: String(repoId) },
      relations: ['channels', 'user'],
    });
    if (!repo || !repo.channels.some((c) => String(c.id) === String(channelId))) {
      throw new RpcException({ msg: 'Repository không tồn tại trong kênh này', status: 404 });
    }

    // 4. Kiểm tra quyền xóa: user là chủ repo hoặc owner channel
    const isRepoOwner = String(repo.user.id) === String(userId);
    const isChannelOwner = channel.owner && String(channel.owner.id) === String(userId);
    if (!isRepoOwner && !isChannelOwner) {
      throw new RpcException({ msg: 'Bạn không có quyền xóa repository này khỏi kênh', status: 403 });
    }

    // 5. Xóa liên kết repo khỏi channel
    repo.channels = repo.channels.filter((c) => String(c.id) !== String(channelId));
    await repoRepo.save(repo);

    return { msg: 'Đã xóa repository khỏi kênh', repo_id: repoId, channel_id: channelId };
  }

}
