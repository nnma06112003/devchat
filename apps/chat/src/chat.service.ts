import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Not, Repository } from 'typeorm';
import { Attachment, Message, User } from '@myorg/entities';
import { Channel } from '@myorg/entities';
import { BaseService } from '@myorg/common';
import { RpcException } from '@nestjs/microservices';
import { Repository as RepoEntity } from '@myorg/entities'; // Đảm bảo import đúng entity Repository
import { ALL_BANNED_KEYWORDS } from './banned-keywords';

@Injectable()
export class ChatService extends BaseService<Message> {
  /**
   * Tham gia kênh chat
   * @param user user hiện tại
   * @param data { id: string, type: 'group' | 'personal' }
   */

  // Danh sách từ khóa vi phạm được import từ file riêng
  private readonly BANNED_KEYWORDS = ALL_BANNED_KEYWORDS;

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
    console.log('✅ Content moderation với keyword filter đã khởi tạo');
  }

  /* ===================== CONTENT MODERATION ===================== */
  /**
   * Kiểm tra nội dung bằng keyword filter (fallback đơn giản)
   */
  private simpleKeywordFilter(text: string): { flagged: boolean; categories: string[] } {
    const lowerText = text.toLowerCase();
    const foundKeywords: string[] = [];
    
    for (const keyword of this.BANNED_KEYWORDS) {
      if (lowerText.includes(keyword.toLowerCase())) {
        foundKeywords.push(keyword);
      }
    }
    
    if (foundKeywords.length > 0) {
      console.log(`🚫 Simple filter detected banned keywords: ${foundKeywords.join(', ')}`);
      return { flagged: true, categories: ['banned_keyword'] };
    }
    
    return { flagged: false, categories: [] };
  }



  /**
   * Kiểm tra nội dung tin nhắn có vi phạm chính sách hay không
   * Sử dụng keyword filter đơn giản
   * @param text Nội dung tin nhắn cần kiểm tra
   * @returns { flagged: boolean, categories: string[] }
   */
  private async moderateContent(text: string): Promise<{ flagged: boolean; categories: string[] }> {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return { flagged: false, categories: [] };
    }

    return this.simpleKeywordFilter(text);
  }


  async joinChannel(user: any, data: { id: string; type: string }) {
  console.log('log join to channel', { user, data });

  if (!user?.id) {
    throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 401 });
  }
  if (!data?.id || !data?.type) {
    throw new RpcException({ msg: 'Thiếu thông tin kênh hoặc loại kênh', status: 400 });
  }

  /** --------------------------------------------------------
   *  XỬ LÝ KÊNH GROUP
   * -------------------------------------------------------- */
  if (data.type === 'group') {
    const channel = await this.channelRepo.findOne({
      where: { id: data.id, type: 'group' },
      relations: ['users'],
    });
   
    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy kênh công khai', status: 404 });
    }
    if (!channel.isActive) {
      throw new RpcException({ msg: 'Kênh đã bị vô hiệu hóa', status: 403 });
    }

    const isMember = channel.users.some((u) => String(u.id) === String(user.id));
    if (isMember) {
      return { msg: 'Bạn đang là thành viên của kênh này', channel };
    }

    const userEntity = await this.userRepo.findOne({ 
      where: { id: user.id } 
    });

    if (!userEntity) {
      throw new RpcException({ 
        msg: 'Không tìm thấy người dùng', 
        status: 404 
      });
    }

    channel.users.push(userEntity);
    channel.member_count = channel.users.length;
    await this.channelRepo.save(channel);

    return { msg: 'Tham gia kênh thành công', channel };
  }

  /** --------------------------------------------------------
   *  XỬ LÝ KÊNH PERSONAL (chat 1-1)
   * -------------------------------------------------------- */
 else if (data.type === 'personal') {
  const userId = String(user.id);
  const otherId = String(data.id);

  console.log("log join to personal channel", { userId, otherId });

  if (userId === otherId) {
    throw new RpcException({ msg: 'Không thể nhắn tin với chính mình', status: 400 });
  }

  // 1. Lấy tất cả kênh personal mà user đã tham gia
  const userPersonalChannels = await this.channelRepo.find({
    where: { type: 'personal', users: { id: user.id } },
    relations: ['users'],
  });

  // 2. Lọc ra kênh chung
  const foundChannel = userPersonalChannels.find(
    (c) =>
      c.users.length === 2 &&
      c.users.some((u) => String(u.id) === userId) &&
      c.users.some((u) => String(u.id) === otherId),
  );

  if (foundChannel) {
    const messageCount = await this.messageRepo.count({
      where: { channel: { id: foundChannel.id } },
    });
    return {
      msg: messageCount > 0 ? 'Bạn đã nhắn tin với người này' : 'Chưa có tin nhắn nào',
      channel: foundChannel,
      hasMessages: messageCount > 0,
      messageCount,
    };
  }

  // 3. Lấy user từ DB để tránh lỗi duplicate constraint
  const currentUser:any = await this.userRepo.findOne({ where: { id: user.id } });
  const otherUser = await this.userRepo.findOne({ where: { id: data.id } });

  if (!otherUser) {
    throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
  }

  // 4. Tạo kênh mới giữa 2 user
  const newChannel = this.channelRepo.create({
    name: 'Personal Chat',
    type: 'personal',
    users: [currentUser, otherUser],     // <-- FIX HERE
    member_count: 2,
  });

  const saved = await this.channelRepo.save(newChannel);

  return {
    msg: 'Hai bạn có thể nhắn tin với nhau',
    channel: saved,
    hasMessages: false,
    messageCount: 0,
  };
}


  throw new RpcException({ msg: 'Kênh không hợp lệ', status: 400 });
}

  async createChannel(
    user: any,
    params: {
      userIds: (string | number)[];
      name?: string;
      type?: 'personal' | 'group' | 'group-private';
      json_data?: any;
      key?: string;
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
      json_data: type === 'group-private' ? params.json_data : undefined,
      key: type === 'group-private' ? params.key : undefined,
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

    let isChannelActive = true;
    let channelName = fullChannel.name;
    if (fullChannel.type === 'personal') {
      const msgCount = await this.messageRepo.count({
        where: { channel: { id: fullChannel.id } },
      });
      isChannelActive = msgCount > 0;
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
      isChannelActive,
      members: (fullChannel?.users || []).map((u: any) =>
        this.remove_field_user({ ...u }),
      ),
    };
  }

  // Gửi tin nhắn vào channel
  async sendMessage(
    user: any,
    data: {
      channelId: string;
      text: string;
      send_at: any;
      type?: string;
      like_data?: any;
      json_data?: any;
      isPin?: boolean;
      id?: any;
      isUpdate?: boolean;
    },
    attachments?: any[],
  ) {
    console.log(`🔍 [DEBUG] Chat service sendMessage called with:`, {
      channelId: data.channelId,
      type: data.type,
      hasJsonData: !!data.json_data,
      jsonDataType: typeof data.json_data,
      text: data.text?.substring(0, 100) + '...',
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

    // Kiểm tra kênh phải active
    if (!channel.isActive) {
      throw new RpcException({
        msg: 'Kênh đã bị vô hiệu hóa, không thể gửi tin nhắn',
        status: 403,
      });
    }

    // ✅ Kiểm tra nội dung tin nhắn trước khi lưu (chỉ với message và reply-message)
    let finalText = data.text;
    const messageType = data.type || 'message';
    
    if ((messageType === 'message' || messageType === 'reply-message') && finalText) {
      const moderation = await this.moderateContent(finalText);
      
      if (moderation.flagged) {
        console.warn(`⚠️ Content flagged for user ${user.id} in channel ${data.channelId}:`, moderation.categories);
        
        // Thay đổi nội dung tin nhắn thành thông báo vi phạm
        finalText = '⚠️ Tin nhắn có nội dung không phù hợp';
        
        // Log lại nội dung gốc để audit (nếu cần)
        console.log(`📝 Original flagged message: "${data.text.substring(0, 100)}..."`);
      }
    }

    // 👉 Update message if requested
    if (data.isUpdate && data.id) {
      const existing = await this.messageRepo.findOne({
        where: { id: data.id, channel: { id: data.channelId } },
        relations: ['sender', 'attachments', 'channel'],
      });
      if (!existing) {
        throw new RpcException({ msg: 'Tin nhắn không tồn tại', status: 404 });
      }
      const existingSenderId =
        typeof existing.sender === 'object'
          ? existing.sender?.id
          : existing.sender;
      if (
        String(existingSenderId) !== String(user.id) &&
        data.type == 'remove'
      ) {
        throw new RpcException({
          msg: 'Bạn không có quyền sửa hay xóa tin nhắn này',
          status: 403,
        });
      }

      existing.text = data.text ?? existing.text;
      existing.json_data = data.json_data ?? existing.json_data;
      existing.type = data.type ?? existing.type;
      existing.isPin = data.isPin ?? existing.isPin;
      existing.like_data = data.like_data ?? existing.like_data;

      console.log('✏️ [DEBUG] Updating message:', {
        id: existing.id,
        type: existing.type,
        hasJsonData: !!existing.json_data,
        text: existing.text?.substring(0, 50) + '...',
      });

      await this.messageRepo.save(existing);
      return existing;
    }

    const messageData = {
      ...data,
      text: finalText, // Sử dụng text đã được kiểm duyệt
      channel,
      sender,
      send_at: data.send_at,
      type: messageType,
      json_data: data.json_data || null,
    };

    console.log(`🔍 [DEBUG] Creating message with data:`, {
      type: messageData.type,
      hasJsonData: !!messageData.json_data,
      text: messageData.text?.substring(0, 50) + '...',
    });

    const message = this.messageRepo.create(messageData);

    await this.messageRepo.save(message);

    console.log(`🔍 [DEBUG] Message saved to database:`, {
      id: message.id,
      type: message.type,
      hasJsonData: !!message.json_data,
      text: message.text?.substring(0, 50) + '...',
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
          isChannelActive: true,
        },
      };
    }

    // Nếu không phải message đầu tiên → chỉ trả về message
    console.log(`🔍 [DEBUG] Returning message:`, {
      id: message.id,
      type: message.type,
      hasJsonData: !!message.json_data,
      text: message.text?.substring(0, 50) + '...',
    });

    return message;
  }

  // Lấy danh sách channel của userId (chỉ channel active)
  async listChannels(user: any) {
    // Trả về danh sách các channel mà user là thành viên

    if (!user || !user.id) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 401 });
    }
    const channels = await this.channelRepo
      .createQueryBuilder('channel')
      .leftJoinAndSelect('channel.users', 'member')
      .leftJoinAndSelect('channel.owner', 'owner') // Load owner
      .leftJoin('channel.users', 'user')
      .where('user.id = :userId', { userId: user?.id })
      .andWhere('channel.isActive = :isActive', { isActive: true })
      .getMany();
    // Trả về danh sách channel, mỗi channel có mảng members đã loại bỏ trường nhạy cảm
    const result = [];
    for (const channel of channels) {
      let isChannelActive = true;
      let channelName = channel.name;
      if (channel.type === 'personal') {
        const msgCount = await this.messageRepo.count({
          where: { channel: { id: channel.id } },
        });
        isChannelActive = msgCount > 0;
        const otherUser = (channel.users || []).find(
          (u) => String(u.id) !== String(user.id),
        );
        if (otherUser && otherUser.username) {
          channelName = otherUser.username;
        }
      }

      // Chuẩn bị owner info cho group và group-private
      let ownerInfo = null;
      if (
        (channel.type === 'group' || channel.type === 'group-private') &&
        channel.owner
      ) {
        ownerInfo = this.remove_field_user({
          ...channel.owner,
          avatar: channel.owner.avatar ?? null,
          github_avatar: channel.owner.github_avatar ?? null,
        });
      }

      // group và group-private luôn isChannelActive = true
      result.push({
        id: channel.id,
        name: channelName,
        key: channel.key,
        json_data: channel.json_data,
        type: channel.type,
        member_count: channel.member_count,
        owner: ownerInfo, // Thêm owner info
        members: (channel.users || []).map((u: any) =>
          this.remove_field_user({
            ...u,
            avatar: u.avatar ?? null,
            github_avatar: u.github_avatar ?? null,
          }),
        ),
        created_at: channel.created_at,
        updated_at: channel.updated_at,
        isChannelActive,
      });
    }
    return result;
  }

  // Thêm sau hàm createChannel

  /**
   * Cập nhật thông tin kênh
   * @param userId ID của user thực hiện update
   * @param channelId ID của kênh cần update
   * @param params Dữ liệu cần cập nhật
   */
  async updateChannel(
    userId: string | number,
    channelId: string | number,
    params: {
      name?: string;
      type?: 'group' | 'group-private';
      key?: string;
      json_data?: any;
      isActive?: boolean; // Cập nhật trạng thái active
      addUserIds?: (string | number)[]; // Thêm thành viên
      removeUserIds?: (string | number)[]; // Xóa thành viên
    },
  ) {
    // 1. Kiểm tra user tồn tại và lấy role
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }

    const isAdmin = user.role === 'admin';

    // 2. Kiểm tra channel tồn tại
    const channel: any = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users', 'owner'],
    });

    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy kênh', status: 404 });
    }

    // 3. Kiểm tra quyền: admin có toàn quyền, không cần là thành viên
    if (channel.type === 'personal') {
      throw new RpcException({
        msg: 'Không thể cập nhật kênh personal',
        status: 400,
      });
    }

    // Nếu không phải admin, kiểm tra quyền owner hoặc PM
    if (!isAdmin) {
      const isOwner =
        channel.owner && String(channel.owner.id) === String(userId);

      // 3.1. Nếu là group-private, kiểm tra thêm role PM
      let isPM = false;
      if (channel.type === 'group-private' && channel.json_data) {
        try {
          const jsonData =
            typeof channel.json_data === 'string'
              ? JSON.parse(channel.json_data)
              : channel.json_data;

          if (jsonData?.userRoles && Array.isArray(jsonData.userRoles)) {
            const userRole = jsonData.userRoles.find(
              (ur: any) => String(ur.userId) === String(userId),
            );
            // Role 1 = PM
            if (userRole && userRole.roles && Array.isArray(userRole.roles)) {
              isPM = userRole.roles.includes(1);
            }
          }
        } catch (error) {
          console.error('Error parsing json_data:', error);
        }
      }

      // Kiểm tra quyền: owner HOẶC PM (nếu là group-private)
      const hasPermission =
        isOwner ||
        (channel.type === 'group-private' && isPM) ||
        channel.type === 'group';

      if (!hasPermission) {
        throw new RpcException({
          msg:
            channel.type === 'group-private'
              ? 'Bạn không có quyền cập nhật kênh này (chỉ Owner hoặc PM)'
              : 'Bạn không có quyền cập nhật kênh này',
          status: 403,
        });
      }
    }

    // 3. Cập nhật tên kênh (nếu có)
    if (params.name !== undefined && params.name.trim()) {
      channel.name = params.name.trim();
    }

    // 3.5. Cập nhật trạng thái isActive (nếu có)
    if (params.isActive !== undefined) {
      channel.isActive = params.isActive;
    }

    // 4. Cập nhật type (chỉ cho phép chuyển đổi giữa group và group-private)
    if (params.type !== undefined) {
      if (params.type !== 'group' && params.type !== 'group-private') {
        throw new RpcException({
          msg: 'Loại kênh không hợp lệ',
          status: 400,
        });
      }

      // Nếu chuyển từ group-private về group, xóa key
      if (channel.type === 'group-private' && params.type === 'group') {
        channel.key = null;
        channel.json_data = null;
      }

      channel.type = params.type;
    }

    // 5. Cập nhật key và json_data (chỉ cho group-private)
    if (channel.type === 'group-private') {
      if (params.key !== undefined) {
        channel.key = params.key;
      }
      if (params.json_data !== undefined) {
        // Validate json_data structure
        if (params.json_data) {
          try {
            const jsonData =
              typeof params.json_data === 'string'
                ? JSON.parse(params.json_data)
                : params.json_data;

            // Kiểm tra cấu trúc userRoles
            if (jsonData.userRoles && Array.isArray(jsonData.userRoles)) {
              // Validate mỗi userRole
              for (const userRole of jsonData.userRoles) {
                // userId có thể null, nhưng roles phải là array
                if (!Array.isArray(userRole.roles)) {
                  throw new RpcException({
                    msg: 'Cấu trúc json_data không hợp lệ: roles phải là mảng',
                    json_data: jsonData,
                    status: 400,
                  });
                }
              }
            }

            channel.json_data = jsonData;
          } catch (error: any) {
            if (error instanceof RpcException) {
              throw error;
            }
            throw new RpcException({
              msg: 'json_data không hợp lệ: ' + error.message,
              status: 400,
            });
          }
        } else {
          channel.json_data = params.json_data;
        }
      }
    } else {
      // Nếu không phải group-private, đảm bảo key và json_data là null
      channel.key = null;
      channel.json_data = null;
    }

    // 6. Thêm thành viên (nếu có)
    if (params.addUserIds && params.addUserIds.length > 0) {
      const usersToAdd = await this.userRepo.findBy({
        id: In(params.addUserIds),
      });

      if (usersToAdd.length !== params.addUserIds.length) {
        throw new RpcException({
          msg: 'Một số thành viên không tồn tại',
          status: 400,
        });
      }

      // Lọc những user chưa có trong channel
      const currentMemberIds = new Set(
        channel.users.map((u: any) => String(u.id)),
      );
      const newMembers = usersToAdd.filter(
        (u: any) => !currentMemberIds.has(String(u.id)),
      );

      if (newMembers.length > 0) {
        channel.users.push(...newMembers);
        channel.member_count = channel.users.length;
      }
    }

    // 7. Xóa thành viên (nếu có)
    if (params.removeUserIds && params.removeUserIds.length > 0) {
      // Không cho phép xóa owner
      if (
        params.removeUserIds.some(
          (id) => String(id) === String(channel.owner?.id),
        )
      ) {
        throw new RpcException({
          msg: 'Không thể xóa owner khỏi kênh',
          status: 400,
        });
      }

      const removeIdSet = new Set(params.removeUserIds.map(String));
      channel.users = channel.users.filter(
        (u: any) => !removeIdSet.has(String(u.id)),
      );
      channel.member_count = channel.users.length;

      // Kiểm tra số lượng thành viên tối thiểu
      if (channel.users.length < 2) {
        throw new RpcException({
          msg: 'Kênh phải có ít nhất 2 thành viên',
          status: 400,
        });
      }
    }

    // 8. Lưu thay đổi
    await this.channelRepo.save(channel);

    // 9. Lấy lại channel với đầy đủ relations
    const updatedChannel: any = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users', 'owner'],
    });

    // 10. Format response
    return {
      id: updatedChannel.id,
      name: updatedChannel.name,
      type: updatedChannel.type,
      key: updatedChannel.key,
      json_data: updatedChannel.json_data,
      member_count: updatedChannel.member_count,
      isActive: updatedChannel.isActive,
      owner: updatedChannel.owner
        ? this.remove_field_user({ ...updatedChannel.owner })
        : null,
      members: (updatedChannel.users || []).map((u: any) =>
        this.remove_field_user({
          ...u,
          avatar: u.avatar ?? null,
          github_avatar: u.github_avatar ?? null,
        }),
      ),
      created_at: updatedChannel.created_at,
      updated_at: updatedChannel.updated_at,
    };
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
      latest?: boolean;
      messageId?: string; // chỉ lấy các tin nhắn xung quanh message này (search mode)
      searchRadius?: number; // số lượng tin nhắn lấy mỗi bên (mặc định 25)
    },
    noAuth = false,
  ) {

    console.log('fetch History Dtaat',{
      user,
      channelId,
      options,
      noAuth
    });
    
    // Nếu noAuth = true, chỉ trả về thông tin kênh
    if (noAuth) {
      const channel: any = await this.channelRepo
        .createQueryBuilder('channel')
        .leftJoinAndSelect('channel.owner', 'owner')
        .leftJoinAndSelect('channel.users', 'member')
        .where('channel.id = :channelId', { channelId })
        .getOne();

      if (!channel) {
        throw new RpcException({
          msg: 'Không tìm thấy kênh chat',
          status: 404,
        });
      }

      // Members tối giản
      const members = (channel.users || []).map((u: any) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        avatar: u.avatar ?? null,
        github_avatar: u.github_avatar ?? null,
        isOwner: channel.owner && String(u.id) === String(channel.owner.id),
      }));

      const { users, ...channelInfo } = channel;

      return {
        channel: channelInfo,
        members,
        items: [], // Không trả về items
        total: null,
        page: null,
        pageSize: 0,
        hasMoreOlder: false,
        hasMoreNewer: false,
        cursors: {
          before: null,
          after: null,
        },
      };
    }

    // Logic xác thực và lấy messages như cũ
    const pageSize = Math.min(200, Math.max(1, options?.pageSize ?? 50));
    const searchRadius = Math.min(
      100,
      Math.max(1, options?.searchRadius ?? 25),
    );

    // 1) Kiểm tra quyền truy cập kênh và channel phải active
    // Kiểm tra channel tồn tại và active
    const channelExists = await this.channelRepo.findOne({
      where: { id: channelId, isActive: true },
      select: ['id'],
    });

    if (!channelExists) {
      throw new RpcException({
        msg: 'Không tìm thấy kênh chat hoặc kênh đã bị vô hiệu hóa',
        status: 404,
      });
    }

    // Nếu user không phải admin, kiểm tra membership
    if (user.role !== 'admin') {
      const isMember = await this.channelRepo
        .createQueryBuilder('c')
        .innerJoin('c.users', 'u', 'u.id = :userId', { userId: user.id })
        .where('c.id = :channelId', { channelId })
        .getExists();

      if (!isMember) {
        throw new RpcException({
          msg: 'Bạn không có quyền truy cập kênh này',
          status: 403,
        });
      }
    }

    // 2) Lấy channel + owner + users (để build members/sender)
    const channel: any = await this.channelRepo
      .createQueryBuilder('channel')
      .leftJoinAndSelect('channel.owner', 'owner')
      .leftJoinAndSelect('channel.users', 'member')
      .where('channel.id = :channelId', { channelId })
      .getOne();

    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy kênh chat', status: 404 });
    }

    // 🆕 XỬ LÝ SEARCH MODE: Lấy tin nhắn xung quanh messageId
    if (options?.messageId) {
      const targetMessage = await this.messageRepo.findOne({
        where: { id: options.messageId, channel: { id: channelId } },
        select: ['id', 'send_at'],
      });

      if (!targetMessage) {
        throw new RpcException({
          msg: 'Không tìm thấy tin nhắn',
          status: 404,
        });
      }

      // Lấy tin nhắn CŨ HƠN (older)
      const olderMessages = await this.messageRepo
        .createQueryBuilder('message')
        .leftJoinAndSelect('message.sender', 'sender')
        .leftJoinAndSelect('message.attachments', 'attachment')
        .where('message.channelId = :channelId', { channelId })
        .andWhere(
          `(message.send_at < :targetTime)
         OR (message.send_at = :targetTime AND message.id < :targetId)`,
          { targetTime: targetMessage.send_at, targetId: targetMessage.id },
        )
        .orderBy('message.send_at', 'DESC')
        .addOrderBy('message.id', 'DESC')
        .take(searchRadius)
        .getMany();

      // Lấy tin nhắn MỚI HƠN (newer)
      const newerMessages = await this.messageRepo
        .createQueryBuilder('message')
        .leftJoinAndSelect('message.sender', 'sender')
        .leftJoinAndSelect('message.attachments', 'attachment')
        .where('message.channelId = :channelId', { channelId })
        .andWhere(
          `(message.send_at > :targetTime)
         OR (message.send_at = :targetTime AND message.id > :targetId)`,
          { targetTime: targetMessage.send_at, targetId: targetMessage.id },
        )
        .orderBy('message.send_at', 'ASC')
        .addOrderBy('message.id', 'ASC')
        .take(searchRadius)
        .getMany();

      // Lấy target message với đầy đủ relations
      const targetMessageFull = await this.messageRepo.findOne({
        where: { id: options.messageId },
        relations: ['sender', 'attachments'],
      });

      // Ghép: older (đảo ngược) + target + newer
      const rows = [
        ...olderMessages.reverse(),
        targetMessageFull,
        ...newerMessages,
      ];

      // Chuẩn hóa sender & flags
      const items = rows.map((msg: any) => {
        let senderInfo: any = undefined;
        let isMine = false;

        if (msg.sender) {
          if (typeof msg.sender === 'object') {
            senderInfo = this.remove_field_user({
              ...msg.sender,
              avatar: msg.sender.avatar || msg.sender.github_avatar,
            });
            isMine = String(msg.sender.id) === String(user.id);
          } else {
            const senderObj = (channel.users || []).find(
              (u: any) => String(u.id) === String(msg.sender),
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
          isSearch: String(msg.id) === String(options.messageId), // 🆕 Đánh dấu tin nhắn được search
        };
      });

      // Cursors cho search mode
      const oldest = items[0];
      const newest = items[items.length - 1];
      const targetIndex = items.findIndex((m) => m.isSearch);

      // Members
      const members = (channel.users || []).map((u: any) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        avatar: u.avatar ?? null,
        github_avatar: u.github_avatar ?? null,
        isMine: String(u.id) === String(user.id),
        isOwner: channel.owner && String(u.id) === String(channel.owner.id),
      }));

      const { users, ...channelInfo } = channel;

      return {
        channel: channelInfo,
        members,
        items,
        total: null,
        page: null,
        pageSize: items.length,
        hasMoreOlder: olderMessages.length === searchRadius, // Còn tin nhắn cũ hơn
        hasMoreNewer: newerMessages.length === searchRadius, // Còn tin nhắn mới hơn
        searchMode: true, // 🆕 Đánh dấu là search mode
        targetIndex, // 🆕 Vị trí của tin nhắn được search
        cursors: {
          before: oldest?.id ?? null,
          after: newest?.id ?? null,
        },
      };
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
          senderInfo = this.remove_field_user({
            ...msg.sender,
            avatar: msg.sender.avatar || msg.sender.github_avatar,
          });
          isMine = String(msg.sender.id) === String(user.id);
        } else {
          const senderObj = (channel.users || []).find(
            (u: any) => String(u.id) === String(msg.sender),
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
        isSearch: false, // 🆕 Không phải search mode
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
    const members = (channel.users || []).map((u: any) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      avatar: u.avatar ?? null,
      github_avatar: u.github_avatar ?? null,
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
        .andWhere('c.isActive = :isActive', { isActive: true })
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
        .leftJoinAndSelect('c.users', 'members') // load tất cả members
        .select(['c.id', 'c.name', 'c.type', 'c.key', 'c.json_data'])
        .addSelect([
          'members.id',
          'members.username',
          'members.email',
          'members.avatar',
          'members.github_avatar',
        ])
        .where('c.type = :type', { type: 'group-private' })
        .andWhere('c.isActive = :isActive', { isActive: true })
        .andWhere('LOWER(c.name) LIKE :key', { key: `%${key}%` })
        .take(limit)
        .getMany();

      return channels.map((ch: any) => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        key: ch.key ?? null,
        json_data: ch.json_data ?? null,
        isMember: true,
        members: (ch.users || []).map((u: any) =>
          this.remove_field_user({
            ...u,
            avatar: u.avatar ?? null,
            github_avatar: u.github_avatar ?? null,
          }),
        ),
      }));
    };

    const searchPersonalChannels = async () => {
      const channels = await this.channelRepo
        .createQueryBuilder('c')
        .innerJoin('c.users', 'u') // user hiện tại
        .innerJoin('c.users', 'ou') // other user
        .select(['c.id', 'c.type', 'ou.username']) // chỉ cần id, type, username
        .where('c.type = :type', { type: 'personal' })
        .andWhere('c.isActive = :isActive', { isActive: true })
        .andWhere('u.id = :uid', { uid: user.id })
        .andWhere('ou.id != :uid', { uid: user.id })
        .andWhere('LOWER(ou.username) LIKE :key', { key: `%${key}%` })
        .take(limit)
        .getRawMany(); // dùng rawMany cho tiện mapping

      return channels.map((ch) => ({
        id: ch.c_id,
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
    repoIds: string[],
  ) {
    // 1. Kiểm tra danh sách repo_id hợp lệ
    if (!Array.isArray(repoIds) || repoIds.length === 0) {
      throw new RpcException({
        msg: 'Danh sách Repository không hợp lệ',
        status: 400,
      });
    }

    // 2. Kiểm tra user tồn tại và đã có installation_id
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy user', status: 404 });
    }
    if (!user.github_installation_id) {
      throw new RpcException({
        msg: 'User chưa cài đặt GitHub App',
        status: 400,
      });
    }

    // 3. Kiểm tra channel tồn tại và user là thành viên
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users'],
    });
    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy channel', status: 404 });
    }
    if (!channel.isActive) {
      throw new RpcException({ msg: 'Kênh đã bị vô hiệu hóa', status: 403 });
    }
    const isMember = channel.users.some(
      (u) => String(u.id) === String(user.id),
    );
    if (!isMember) {
      throw new RpcException({
        msg: 'Bạn không phải thành viên của kênh này',
        status: 403,
      });
    }

    // 4. Kiểm tra repo đã liên kết với channel chưa
    const repoRepo = this.attachmentRepo.manager.getRepository(RepoEntity);
    for (const rpid of repoIds) {
      const repo = await repoRepo.findOne({
        where: { repo_id: rpid, user: { id: user.id } },
        relations: ['channels'],
      });
      if (
        repo &&
        repo.channels?.some((c) => String(c.id) === String(channel.id))
      ) {
        throw new RpcException({
          msg: `Không được thêm trùng Repository`,
          status: 400,
        });
      }
    }

    // 5. Thêm các repo vào DB (nếu chưa có), liên kết với user và channel
    const repos: RepoEntity[] = [];
    for (const rpid of repoIds) {
      let repo = await repoRepo.findOne({
        where: { repo_id: rpid, user: { id: user.id } },
        relations: ['channels'],
      });
      if (!repo) {
        repo = repoRepo.create({ repo_id: rpid, user });
        await repoRepo.save(repo);
      }
      // Liên kết repo với channel nếu chưa có
      if (!repo.channels) repo.channels = [];
      const alreadyLinked = repo.channels.some(
        (c) => String(c.id) === String(channel.id),
      );
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
      order?: 'asc' | 'desc';
      limit?: number;
      page?: number;
    },
  ) {
    // Set default values
    const order = data.order ?? 'asc';
    const limit = data.limit ?? 20;
    const page = data.page ?? 1;

    // 1. Kiểm tra user role
    const user = await this.userRepo.findOne({ 
      where: { id: userId },
      select: ['id', 'role']
    });
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }
    const isAdmin = user.role === 'admin';

    // 2. Kiểm tra channel tồn tại và user là thành viên (admin bỏ qua check membership)
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users', 'repositories', 'repositories.user'],
    });
    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy channel', status: 404 });
    }
    if (!channel.isActive) {
      throw new RpcException({ msg: 'Kênh đã bị vô hiệu hóa', status: 403 });
    }

    // Admin không cần check membership
    if (!isAdmin) {
      const isMember = channel.users.some((u) => String(u.id) === String(userId));
      if (!isMember) {
        throw new RpcException({
          msg: 'Bạn không phải thành viên của kênh này',
          status: 403,
        });
      }
    }

    // 3. Lấy danh sách repo, sort theo id
    let repos = [...(channel.repositories || [])];
    repos.sort((a, b) =>
      order === 'asc'
        ? Number(a.id) - Number(b.id)
        : Number(b.id) - Number(a.id),
    );

    // 4. Phân trang
    const total = repos.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const pagedRepos = repos.slice(start, end);

    // 5. Trả về thông tin repo cần thiết
    return {
      total,
      page,
      limit,
      items: pagedRepos.map((repo) => ({
        repo_id: repo.repo_id,
        user_id: repo.user?.id || null,
        repo_installation: repo.user?.github_installation_id || null,
      })),
    };
  }

  async removeRepositoryFromChannel(
    userId: string | number,
    channelId: string | number,
    repoId: string | number,
  ) {
    // 1. Kiểm tra user tồn tại và role
    const user = await this.userRepo.findOne({ 
      where: { id: userId },
      select: ['id', 'role']
    });
    if (!user)
      throw new RpcException({ msg: 'Không tìm thấy user', status: 404 });
    
    const isAdmin = user.role === 'admin';

    // 2. Kiểm tra channel tồn tại và user là thành viên (admin bỏ qua check membership)
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users', 'repositories', 'owner'],
    });
    if (!channel)
      throw new RpcException({ msg: 'Không tìm thấy channel', status: 404 });
    if (!channel.isActive)
      throw new RpcException({ msg: 'Kênh đã bị vô hiệu hóa', status: 403 });
    
    // Admin không cần check membership
    if (!isAdmin) {
      const isMember = channel.users.some((u) => String(u.id) === String(userId));
      if (!isMember)
        throw new RpcException({
          msg: 'Bạn không phải thành viên của kênh này',
          status: 403,
        });
    }

    // 3. Kiểm tra repo tồn tại trong channel
    const repoRepo = this.attachmentRepo.manager.getRepository(RepoEntity);
    const repo = await repoRepo.findOne({
      where: { repo_id: String(repoId) },
      relations: ['channels', 'user'],
    });
    if (
      !repo ||
      !repo.channels.some((c) => String(c.id) === String(channelId))
    ) {
      throw new RpcException({
        msg: 'Repository không tồn tại trong kênh này',
        status: 404,
      });
    }

    // 4. Kiểm tra quyền xóa: admin có toàn quyền, user thường phải là chủ repo hoặc owner channel
    if (!isAdmin) {
      const isRepoOwner = String(repo.user.id) === String(userId);
      const isChannelOwner =
        channel.owner && String(channel.owner.id) === String(userId);
      if (!isRepoOwner && !isChannelOwner) {
        throw new RpcException({
          msg: 'Bạn không có quyền xóa repository này khỏi kênh',
          status: 403,
        });
      }
    }

    // 5. Xóa liên kết repo khỏi channel
    repo.channels = repo.channels.filter(
      (c) => String(c.id) !== String(channelId),
    );
    await repoRepo.save(repo);

    return {
      msg: 'Đã xóa repository khỏi kênh',
      repo_id: repoId,
      channel_id: channelId,
    };
  }

  async addMembersToChannel(
    userId: string | number,
    channelId: string | number,
    memberIds: (string | number)[],
  ) {
    // 1. Kiểm tra danh sách memberIds hợp lệ
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      throw new RpcException({
        msg: 'Danh sách thành viên không hợp lệ',
        status: 400,
      });
    }

    // 2. Kiểm tra channel tồn tại
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users', 'owner'],
    });
    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy channel', status: 404 });
    }
    if (!channel.isActive) {
      throw new RpcException({ msg: 'Kênh đã bị vô hiệu hóa', status: 403 });
    }

    // 3. Kiểm tra user là owner của channel
    const isOwner = String(channel?.owner?.id) === String(userId);
    if (!isOwner) {
      throw new RpcException({
        msg: 'Bạn không có quyền thêm thành viên vào kênh này',
        status: 403,
      });
    }

    // 4. Thêm thành viên vào channel
    const users = await this.userRepo.findBy({ id: In(memberIds) });
    channel.users.push(...users);
    await this.channelRepo.save(channel);

    return {
      msg: 'Đã thêm thành viên vào kênh',
      channel_id: channelId,
      member_ids: memberIds,
    };
  }

  async removeMembersFromChannel(
    userId: string | number,
    channelId: string | number,
    memberIds: (string | number)[],
  ) {
    // 1. Kiểm tra danh sách memberIds hợp lệ
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      throw new RpcException({
        msg: 'Danh sách thành viên không hợp lệ',
        status: 400,
      });
    }
    // 2. Kiểm tra channel tồn tại
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users'],
    });
    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy channel', status: 404 });
    }
    if (!channel.isActive) {
      throw new RpcException({ msg: 'Kênh đã bị vô hiệu hóa', status: 403 });
    }
    // 3. Kiểm tra user là owner của channel
    const isOwner = String(channel?.owner?.id) === String(userId);
    if (!isOwner) {
      throw new RpcException({
        msg: 'Bạn không có quyền xóa thành viên khỏi kênh này',
        status: 403,
      });
    }
    // 4. Xóa thành viên khỏi channel
    channel.users = channel.users.filter((u) => !memberIds.includes(u.id));
    await this.channelRepo.save(channel);
    return {
      msg: 'Đã xóa thành viên khỏi kênh',
      channel_id: channelId,
      member_ids: memberIds,
    };
  }

  //list member that not in channel
  async listNonMembers(
    channelId: string | number,
    username?: string,
    limit?: number,
    cursor?: number | string,
  ) {
    limit = limit ?? 20;

    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
      relations: ['users'],
    });

    if (!channel) {
      throw new RpcException({ msg: 'Không tìm thấy channel', status: 404 });
    }

    if (!channel.isActive) {
      throw new RpcException({ msg: 'Kênh đã bị vô hiệu hóa', status: 403 });
    }

    const memberIds = channel.users.map((u) => u.id);

    const qb = this.userRepo
      .createQueryBuilder('user')
      .where('user.id NOT IN (:...memberIds)', {
        memberIds: memberIds.length > 0 ? memberIds : [0],
      })
      .orderBy('user.id', 'ASC')
      .take(limit + 1);

    // Cursor pagination: chỉ lấy users có id > cursor
    if (cursor) {
      qb.andWhere('user.id > :cursor', { cursor });
    }

    if (username && username.trim()) {
      qb.andWhere('LOWER(user.username) LIKE :username', {
        username: `%${username.trim().toLowerCase()}%`,
      });
    }

    const users = await qb
      .select(['user.id', 'user.username', 'user.email'])
      .getMany();

    const hasMore = users.length > limit;
    const items = users.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      users: items.map((u) => this.remove_field_user({ ...u })),
      nextCursor,
      hasMore,
    };
  }

  //Tìm kiếm tin nhắn
  async searchMessages(
    userId: string | number,
    params: {
      query: string; // text cần tìm
      channelId?: string | number; // filter theo channel
      senderId?: string | number; // filter theo người gửi
      startDate?: Date; // filter từ ngày
      endDate?: Date; // filter đến ngày
      limit?: number; // số kết quả mỗi page (default 20)
      cursor?: number; // message.id để cursor pagination
    },
  ) {
    const {
      query,
      channelId,
      senderId,
      startDate,
      endDate,
      limit = 20,
      cursor,
    } = params;

    if (!query || query.trim().length < 2) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    // 1. Kiểm tra role của user
    const user = await this.userRepo.findOne({ 
      where: { id: userId },
      select: ['id', 'role']
    });
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }
    const isAdmin = user.role === 'admin';

    // 2. Build query với joins
    const qb = this.messageRepo
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.channel', 'channel')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.attachments', 'attachments')
      .where('message.text ILIKE :query', { query: `%${query.trim()}%` })
      .andWhere('message.type IN (:...types)', {
        types: ['message', 'reply-message', 'file-upload'], // chỉ search message types
      })
      .orderBy('message.created_at', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .take(limit + 1);

    // 3. Cursor pagination
    if (cursor) {
      qb.andWhere('message.id < :cursor', { cursor });
    }

    // 4. Filter theo channelId (nếu có)
    if (channelId) {
      // Admin không cần check membership, user thường phải check
      if (!isAdmin) {
        const isMember = await this.channelRepo
          .createQueryBuilder('c')
          .innerJoin('c.users', 'u', 'u.id = :userId', { userId })
          .where('c.id = :channelId', { channelId })
          .andWhere('c.isActive = :isActive', { isActive: true })
          .getExists();

        if (!isMember) {
          throw new RpcException({
            msg: 'Bạn không có quyền xem kênh này hoặc kênh không khả dụng',
            status: 403,
          });
        }
      } else {
        // Admin chỉ check channel active
        const channelActive = await this.channelRepo
          .createQueryBuilder('c')
          .where('c.id = :channelId', { channelId })
          .andWhere('c.isActive = :isActive', { isActive: true })
          .getExists();

        if (!channelActive) {
          throw new RpcException({
            msg: 'Kênh không tồn tại hoặc không khả dụng',
            status: 404,
          });
        }
      }
      
      qb.andWhere('channel.id = :channelId', { channelId });
    } else {
      // Admin có thể search tất cả channels active
      if (isAdmin) {
        qb.andWhere('channel.isActive = :isActive', { isActive: true });
      } else {
        // User thường chỉ search trong channels mình là member và active
        const userChannels = await this.channelRepo
          .createQueryBuilder('channel')
          .leftJoin('channel.users', 'user')
          .where('user.id = :userId', { userId })
          .andWhere('channel.isActive = :isActive', { isActive: true })
          .select('channel.id')
          .getMany();

        const channelIds = userChannels.map((c) => c.id);
        if (channelIds.length === 0) {
          return { items: [], nextCursor: null, hasMore: false };
        }
        qb.andWhere('channel.id IN (:...channelIds)', { channelIds });
      }
    }

    // 4. Filter theo senderId (nếu có)
    if (senderId) {
      qb.andWhere('sender.id = :senderId', { senderId });
    }

    // 5. Filter theo date range (nếu có)
    if (startDate) {
      qb.andWhere('message.created_at >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('message.created_at <= :endDate', { endDate });
    }

    // 6. Execute query
    const messages = await qb.getMany();

    // 7. Check hasMore và tính nextCursor
    const hasMore = messages.length > limit;
    const items = messages.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    // 8. Format response (remove sensitive fields)
    const formatted = items.map((msg) => ({
      ...msg,
      sender: msg.sender
        ? {
            id: msg.sender.id,
            username: msg.sender.username,
            email: msg.sender.email,
            avatar: msg.sender.avatar,
          }
        : null,
    }));

    return {
      items: formatted,
      nextCursor,
      hasMore,
    };
  }

  async searchMessagesByKeyword(
    userId: string | number,
    params: {
      key: string; // keyword để search
      channelId?: string | number; // filter theo channel (optional)
      limit?: number; // số kết quả mỗi page (default 20)
      page?: number; // số trang (default 1)
    },
  ) {
    const { key, channelId, limit = 20, page = 1 } = params;

    // 1. Validate keyword
    if (!key || key.trim().length < 2) {
      return {
        items: [],
        total: 0,
        page: 1,
        limit,
        totalPages: 0,
        hasMore: false,
      };
    }

    const keyword = key.trim().toLowerCase();
    const take = Math.min(100, Math.max(1, limit));
    const skip = (Math.max(1, page) - 1) * take;

    // 2. Kiểm tra role của user
    const user = await this.userRepo.findOne({ 
      where: { id: userId },
      select: ['id', 'role']
    });
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }
    const isAdmin = user.role === 'admin';

    // 3. Build base query
    const qb = this.messageRepo
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.channel', 'channel')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.attachments', 'attachments')
      .where('LOWER(message.text) LIKE :keyword', { keyword: `%${keyword}%` })
      .andWhere('message.type IN (:...types)', {
        types: [
          'message',
          'reply-message',
          'file-upload',
          'code-card',
          'tool',
          'ba-require',
          'tester-report',
        ],
      });

    // 4. Filter theo channelId nếu có
    if (channelId) {
      // Admin không cần check membership, user thường phải check
      if (!isAdmin) {
        const isMember = await this.channelRepo
          .createQueryBuilder('c')
          .innerJoin('c.users', 'u', 'u.id = :userId', { userId })
          .where('c.id = :channelId', { channelId })
          .andWhere('c.isActive = :isActive', { isActive: true })
          .getExists();

        if (!isMember) {
          throw new RpcException({
            msg: 'Bạn không có quyền xem kênh này',
            status: 403,
          });
        }
      } else {
        // Admin chỉ check channel active
        const channelActive = await this.channelRepo
          .createQueryBuilder('c')
          .where('c.id = :channelId', { channelId })
          .andWhere('c.isActive = :isActive', { isActive: true })
          .getExists();

        if (!channelActive) {
          throw new RpcException({
            msg: 'Kênh không tồn tại hoặc không khả dụng',
            status: 404,
          });
        }
      }

      qb.andWhere('channel.id = :channelId', { channelId });
    } else {
      // Admin có thể search tất cả channels active
      if (isAdmin) {
        qb.andWhere('channel.isActive = :isActive', { isActive: true });
      } else {
        // User thường chỉ search trong channels mình là member và active
        const userChannels = await this.channelRepo
          .createQueryBuilder('channel')
          .innerJoin('channel.users', 'user', 'user.id = :userId', { userId })
          .andWhere('channel.isActive = :isActive', { isActive: true })
          .select('channel.id')
          .getMany();

        const channelIds = userChannels.map((c) => c.id);
        if (channelIds.length === 0) {
          return {
            items: [],
            total: 0,
            page: 1,
            limit: take,
            totalPages: 0,
            hasMore: false,
          };
        }
        qb.andWhere('channel.id IN (:...channelIds)', { channelIds });
      }
    }

    // 4. Get total count
    const total = await qb.getCount();
    const totalPages = Math.ceil(total / take);
    const hasMore = page < totalPages;

    // 5. Get paginated results
    const messages = await qb
      .orderBy('message.send_at', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .skip(skip)
      .take(take)
      .getMany();

    // 6. Format response với highlight keyword
    const items = messages.map((msg) => {
      let senderInfo = null;
      if (msg.sender) {
        senderInfo = {
          id: msg.sender.id,
          username: msg.sender.username,
          email: msg.sender.email,
          avatar: msg.sender.avatar ?? msg.sender.github_avatar ?? null,
        };
      }

      const attachments = (msg.attachments || []).map((att) => ({
        id: att.id,
        filename: att.filename,
        fileUrl: att.fileUrl,
        mimeType: att.mimeType,
        fileSize: att.fileSize,
        key: att.key,
      }));

      // Highlight keyword trong text (wrap bằng <mark> tag)
      let highlightedText = msg.text;
      if (msg.text && keyword) {
        const regex = new RegExp(`(${keyword})`, 'gi');
        highlightedText = msg.text.replace(regex, '<mark>$1</mark>');
      }

      return {
        id: msg.id,
        text: msg.text,
        highlightedText: highlightedText, // text có highlight
        send_at: msg.send_at,
        created_at: msg.created_at,
        type: msg.type,
        json_data: msg.json_data,
        channelId: msg.channel?.id,
        channelName: msg.channel?.name,
        channelType: msg.channel?.type,
        sender: senderInfo,
        attachments,
        isMine: String(msg.sender?.id) === String(userId),
      };
    });

    return {
      items,
      total,
      page: Math.max(1, page),
      limit: take,
      totalPages,
      hasMore,
      keyword, // trả về keyword để frontend biết
    };
  }

  /**
   * Lấy danh sách channel ID chứa repo_id
   * @param userId ID của user yêu cầu
   * @param repoId ID của repository
   * @returns Danh sách channel IDs
   */
  async getChannelsByRepositoryId(
    userId: string | number,
    repoId: string | number,
  ) {
    // 1. Kiểm tra user tồn tại
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy user', status: 404 });
    }

    // 2. Tìm repository với relations channels
    const repoRepo = this.attachmentRepo.manager.getRepository(RepoEntity);
    const repo = await repoRepo.findOne({
      where: { repo_id: String(repoId) },
      relations: ['channels', 'channels.users', 'user'],
    });

    if (!repo) {
      throw new RpcException({
        msg: 'Repository không tồn tại',
        status: 404,
      });
    }

    // 3. Lọc các channel mà user là thành viên và channel phải active
    const userChannels = (repo.channels || []).filter((channel) =>
      channel.isActive && channel.users.some((u) => String(u.id) === String(userId)),
    );

    // 4. Trả về danh sách channel IDs và thông tin chi tiết
    return {
      repo_id: repo.repo_id,
      repo_owner_id: repo.user?.id,
      total_channels: userChannels.length,
      channel_ids: userChannels.map((ch) => ch.id),
      channels: userChannels.map((ch) => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        member_count: ch.member_count,
      })),
    };
  }

  /**
   * Lấy danh sách channel ID chứa nhiều repo_id (batch)
   * @param userId ID của user yêu cầu
   * @param data { repoIds: string[] }
   * @returns Mảng channel IDs
   */
  async getChannelsByRepositoryIds(
    userId: string | number,
    data: {
      repoIds: string[];
    },
  ) {
    if (!Array.isArray(data.repoIds) || data.repoIds.length === 0) {
      throw new RpcException({
        msg: 'Danh sách repository IDs không hợp lệ',
        status: 400,
      });
    }

    // 1. Kiểm tra user tồn tại
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy user', status: 404 });
    }

    // 2. Tìm tất cả repositories
    const repoRepo = this.attachmentRepo.manager.getRepository(RepoEntity);
    const repos = await repoRepo.find({
      where: { repo_id: In(data.repoIds) },
      relations: ['channels', 'channels.users'],
    });

    // 3. Lấy tất cả channel IDs mà user là thành viên và channel phải active
    const channelIds = new Set<string>();

    for (const repo of repos) {
      for (const channel of repo.channels || []) {
        // Kiểm tra user có phải là thành viên của channel không và channel phải active
        const isMember = channel.users.some(
          (u) => String(u.id) === String(userId),
        );
        if (isMember && channel.isActive) {
          channelIds.add(String(channel.id));
        }
      }
    }

    // 4. Trả về mảng channel IDs
    return Array.from(channelIds);
  }

   /**
   * CRUD cho admin quản lý channels
   * @param userId ID của admin
   * @param data Dữ liệu tùy theo method
   * @param method 'create' | 'read-one' | 'read-all' | 'update' | 'delete' | 'stats'
   */
  async channelCRUD(userId: any, data: any, method?: string): Promise<any> {
    // 1. Kiểm tra user tồn tại và có quyền admin
    const user: any = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }
    if (user.role !== 'admin') {
      throw new RpcException({
        msg: 'Không có quyền thực hiện hành động này',
        status: 403,
      });
    }

    switch (method) {
      case 'create': {
        // Tạo channel mới
        // data.name: string (required)
        // data.type: 'personal' | 'group' | 'group-private' (required)
        // data.userIds: string[] (required, ít nhất 2 users)
        // data.ownerId?: string (optional, mặc định là user đầu tiên)
        // data.key?: string (optional, cho group-private)
        // data.json_data?: any (optional, cho group-private)

        if (!data.name || !data.type || !Array.isArray(data.userIds)) {
          throw new RpcException({
            msg: 'Thiếu thông tin: name, type, userIds',
            status: 400,
          });
        }

        if (data.userIds.length < 2) {
          throw new RpcException({
            msg: 'Channel phải có ít nhất 2 thành viên',
            status: 400,
          });
        }

        const members = await this.userRepo.findBy({
          id: In(data.userIds),
        });

        if (members.length !== data.userIds.length) {
          throw new RpcException({
            msg: 'Một số user không tồn tại',
            status: 400,
          });
        }

        let owner = null;
        if (data.type === 'group' || data.type === 'group-private') {
          const ownerId = data.ownerId || data.userIds[0];
          owner = members.find((m) => String(m.id) === String(ownerId));
          if (!owner) {
            throw new RpcException({
              msg: 'Owner phải là thành viên của channel',
              status: 400,
            });
          }
        }

        const newChannel = this.channelRepo.create({
          name: data.name.trim(),
          type: data.type,
          users: members,
          member_count: members.length,
          owner: owner || undefined,
          key: data.type === 'group-private' ? data.key : null,
          json_data: data.type === 'group-private' ? data.json_data : null,
        });

        const saved: any = await this.channelRepo.save(newChannel);

        // Lấy lại với relations
        const fullChannel: any = await this.channelRepo.findOne({
          where: { id: saved.id },
          relations: ['users', 'owner'],
        });

        return {
          id: fullChannel.id,
          name: fullChannel.name,
          type: fullChannel.type,
          key: fullChannel.key,
          json_data: fullChannel.json_data,
          member_count: fullChannel.member_count,
          owner: fullChannel.owner
            ? this.remove_field_user({ ...fullChannel.owner })
            : null,
          members: (fullChannel.users || []).map((u: any) =>
            this.remove_field_user({
              ...u,
              avatar: u.avatar ?? u.github_avatar ?? null,
            }),
          ),
          isActive: fullChannel.isActive,
          created_at: fullChannel.created_at,
          updated_at: fullChannel.updated_at,
        };
      }

      case 'read-one': {
        // Đọc thông tin channel với tin nhắn (giống fetchHistory)
        // data.id: string (required - channelId)
        // data.pageSize?: number (default 50, max 200)
        // data.before?: string (messageId cursor để lấy tin nhắn cũ hơn)
        // data.after?: string (messageId cursor để lấy tin nhắn mới hơn)
        // data.latest?: boolean (chỉ lấy 1 tin mới nhất)

        if (!data.id) {
          throw new RpcException({
            msg: 'Thiếu channelId',
            status: 400,
          });
        }

        const channel: any = await this.channelRepo.findOne({
          where: { id: data.id },
          relations: ['users', 'owner', 'repositories'],
        });

        if (!channel) {
          throw new RpcException({
            msg: 'Không tìm thấy channel',
            status: 404,
          });
        }

        // Đếm số tin nhắn
        const messageCount = await this.messageRepo.count({
          where: { channel: { id: channel.id } },
        });

        // Lấy tin nhắn giống fetchHistory
        const pageSize = Math.min(200, Math.max(1, data?.pageSize ?? 50));

        // Helper: lấy anchor (id + send_at)
        const getAnchor = async (id?: string) => {
          if (!id) return undefined;
          return this.messageRepo.findOne({
            where: { id },
            select: ['id', 'send_at'],
          });
        };

        const anchorBefore = await getAnchor(data?.before);
        const anchorAfter = !data?.before ? await getAnchor(data?.after) : undefined;

        // Base QB
        const baseQB = this.messageRepo
          .createQueryBuilder('message')
          .leftJoinAndSelect('message.sender', 'sender')
          .leftJoinAndSelect('message.attachments', 'attachment')
          .where('message.channelId = :channelId', { channelId: data.id });

        let rows: any[] = [];
        let hasMoreOlder = false;
        let hasMoreNewer = false;

        if (data?.latest) {
          // Chỉ lấy 1 tin mới nhất
          rows = await baseQB
            .orderBy('message.send_at', 'DESC')
            .addOrderBy('message.id', 'DESC')
            .take(1)
            .getMany();
          rows = rows.reverse();
        } else if (anchorBefore) {
          // Lấy tin nhắn cũ hơn anchor
          const r = await baseQB
            .andWhere(
              `(message.send_at < :anchorTime) OR (message.send_at = :anchorTime AND message.id < :anchorId)`,
              { anchorTime: anchorBefore.send_at, anchorId: anchorBefore.id },
            )
            .orderBy('message.send_at', 'DESC')
            .addOrderBy('message.id', 'DESC')
            .take(pageSize + 1)
            .getMany();

          hasMoreOlder = r.length > pageSize;
          rows = r.slice(0, pageSize).reverse();
        } else if (anchorAfter) {
          // Lấy tin nhắn mới hơn anchor
          const rAsc = await baseQB
            .andWhere(
              `(message.send_at > :anchorTime) OR (message.send_at = :anchorTime AND message.id > :anchorId)`,
              { anchorTime: anchorAfter.send_at, anchorId: anchorAfter.id },
            )
            .orderBy('message.send_at', 'ASC')
            .addOrderBy('message.id', 'ASC')
            .take(pageSize + 1)
            .getMany();

          hasMoreNewer = rAsc.length > pageSize;
          rows = rAsc.slice(0, pageSize);
        } else {
          // Trang đầu: lấy 50 tin mới nhất
          const r = await baseQB
            .orderBy('message.send_at', 'DESC')
            .addOrderBy('message.id', 'DESC')
            .take(pageSize + 1)
            .getMany();

          hasMoreOlder = r.length > pageSize;
          rows = r.slice(0, pageSize).reverse();
        }

        // Format messages
        const messages = rows.map((msg) => {
          let senderInfo: any = undefined;
          if (msg.sender) {
            senderInfo = {
              id: msg.sender.id,
              username: msg.sender.username,
              email: msg.sender.email,
              avatar: msg.sender.avatar ?? msg.sender.github_avatar ?? null,
            };
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
          };
        });

        // Cursors
        const oldest = messages[0];
        const newest = messages[messages.length - 1];
        const nextBefore = oldest?.id ?? null;
        const nextAfter = newest?.id ?? null;

        return {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          key: channel.key,
          json_data: channel.json_data,
          member_count: channel.member_count,
          messageCount,
          isActive: channel.isActive,
          owner: channel.owner
            ? this.remove_field_user({ ...channel.owner })
            : null,
          members: (channel.users || []).map((u: any) =>
            this.remove_field_user({
              ...u,
              avatar: u.avatar ?? u.github_avatar ?? null,
            }),
          ),
          repositories: (channel.repositories || []).map((r: any) => ({
            id: r.id,
            repo_id: r.repo_id,
          })),
          messages: {
            items: messages,
            pageSize: messages.length,
            hasMoreOlder,
            hasMoreNewer,
            cursors: {
              before: nextBefore,
              after: nextAfter,
            },
          },
          created_at: channel.created_at,
          updated_at: channel.updated_at,
        };
      }

      case 'read-all': {
        // Lấy danh sách channels với filter và phân trang
        // data.keySearch?: string (tìm theo tên channel)
        // data.type?: 'personal' | 'group' | 'group-private' | 'all'
        // data.limit?: number (default 20, max 200)
        // data.page?: number (default 1)
        // data.order?: 'newest' | 'oldest' (default newest)
        // data.hasMessages?: boolean (true: có tin nhắn, false: chưa có, undefined: tất cả)

        const keySearch = (data?.keySearch || '').toString().trim().toLowerCase();
        const limit = Math.max(1, Math.min(200, Number(data?.limit ?? 20)));
        const page = Math.max(1, Number(data?.page ?? 1));
        const order = data?.order === 'oldest' ? 'ASC' : 'DESC';
        const typeFilter = data?.type && data.type !== 'all' ? data.type : null;
        const hasMessagesFilter =
          data && Object.prototype.hasOwnProperty.call(data, 'hasMessages')
            ? data.hasMessages
            : undefined;

        const qb = this.channelRepo
          .createQueryBuilder('channel')
          .leftJoinAndSelect('channel.owner', 'owner')
          .leftJoinAndSelect('channel.users', 'member');

        if (keySearch) {
          qb.andWhere('LOWER(channel.name) LIKE :k', { k: `%${keySearch}%` });
        }

        if (typeFilter) {
          qb.andWhere('channel.type = :type', { type: typeFilter });
        }

        qb.orderBy('channel.created_at', order as 'ASC' | 'DESC');
        qb.skip((page - 1) * limit).take(limit);

        const [channels, total] = await qb.getManyAndCount();

        // Format kết quả với số lượng tin nhắn
        const items = await Promise.all(
          channels.map(async (ch: any) => {
            const messageCount = await this.messageRepo.count({
              where: { channel: { id: ch.id } },
            });

            // Filter theo hasMessages nếu có
            if (
              typeof hasMessagesFilter === 'boolean' &&
              ((hasMessagesFilter && messageCount === 0) ||
                (!hasMessagesFilter && messageCount > 0))
            ) {
              return null;
            }

            return {
              id: ch.id,
              name: ch.name,
              type: ch.type,
              key: ch.key ?? null,
              json_data: ch.json_data ?? null,
              member_count: ch.member_count,
              messageCount,
              owner: ch.owner ? this.remove_field_user({ ...ch.owner }) : null,
              members: (ch.users || []).map((u: any) =>
                this.remove_field_user({
                  ...u,
                  avatar: u.avatar ?? u.github_avatar ?? null,
                }),
              ),
              isActive: ch.isActive,
              created_at: ch.created_at,
              updated_at: ch.updated_at,
            };
          }),
        );

        // Lọc null nếu có filter hasMessages
        const filteredItems = items.filter((item) => item !== null);

        const hasMore = page * limit < total;

        return {
          items: filteredItems,
          total: filteredItems.length,
          page,
          limit,
          hasMore,
        };
      }

      case 'update': {
        // Cập nhật channel (Admin có toàn quyền)
        // data.channelId: string (required)
        // data.name?: string
        // data.type?: 'group' | 'group-private'
        // data.key?: string
        // data.json_data?: any
        // data.ownerId?: string (chuyển owner)
        // data.addUserIds?: string[] (thêm members)
        // data.removeUserIds?: string[] (xóa members)

        if (!data.channelId) {
          throw new RpcException({
            msg: 'Thiếu channelId',
            status: 400,
          });
        }

        const channel: any = await this.channelRepo.findOne({
          where: { id: data.channelId },
          relations: ['users', 'owner'],
        });

        if (!channel) {
          throw new RpcException({
            msg: 'Không tìm thấy channel',
            status: 404,
          });
        }

        // Admin có thể update cả personal channel
        // Cập nhật tên
        if (data.name !== undefined && data.name.trim()) {
          channel.name = data.name.trim();
        }

        // Cập nhật type (không cho chuyển từ personal)
        if (data.type !== undefined) {
          if (channel.type === 'personal') {
            throw new RpcException({
              msg: 'Không thể thay đổi loại kênh personal',
              status: 400,
            });
          }

          if (data.type !== 'group' && data.type !== 'group-private') {
            throw new RpcException({
              msg: 'Loại kênh không hợp lệ',
              status: 400,
            });
          }
          channel.type = data.type;

          if (data.type === 'group') {
            channel.key = null;
            channel.json_data = null;
          }
        }

        // Cập nhật key và json_data (chỉ cho group-private)
        if (channel.type === 'group-private') {
          if (data.key !== undefined) channel.key = data.key;
          if (data.json_data !== undefined) channel.json_data = data.json_data;
        } else if (channel.type === 'group') {
          // Kênh group không có key và json_data
          channel.key = null;
          channel.json_data = null;
        }

        // Chuyển owner (admin có thể chuyển owner cho bất kỳ ai)
        if (data.ownerId !== undefined) {
          const newOwner = await this.userRepo.findOne({
            where: { id: data.ownerId },
          });
          if (!newOwner) {
            throw new RpcException({
              msg: 'Owner mới không tồn tại',
              status: 404,
            });
          }
          // Kiểm tra owner mới có là thành viên không
          const isOwnerMember = channel.users.some(
            (u: any) => String(u.id) === String(newOwner.id),
          );
          if (!isOwnerMember) {
            throw new RpcException({
              msg: 'Owner mới phải là thành viên của kênh',
              status: 400,
            });
          }
          channel.owner = newOwner;
        }

        // Thêm thành viên (cho cả group và group-private)
        if (data.addUserIds && Array.isArray(data.addUserIds) && data.addUserIds.length > 0) {
          if (channel.type !== 'group' && channel.type !== 'group-private') {
            throw new RpcException({
              msg: 'Chỉ có thể thêm thành viên vào kênh group hoặc group-private',
              status: 400,
            });
          }

          const usersToAdd = await this.userRepo.findBy({
            id: In(data.addUserIds),
          });

          if (usersToAdd.length !== data.addUserIds.length) {
            throw new RpcException({
              msg: 'Một số thành viên không tồn tại',
              status: 400,
            });
          }

          const currentMemberIds = new Set(
            channel.users.map((u: any) => String(u.id)),
          );
          const newMembers = usersToAdd.filter(
            (u: any) => !currentMemberIds.has(String(u.id)),
          );

          if (newMembers.length > 0) {
            channel.users.push(...newMembers);
            channel.member_count = channel.users.length;

            // Nếu là group-private và có json_data.userRoles, cần cập nhật roles cho members mới
            if (channel.type === 'group-private' && channel.json_data) {
              try {
                const jsonData = typeof channel.json_data === 'string'
                  ? JSON.parse(channel.json_data)
                  : channel.json_data;

                if (jsonData.userRoles && Array.isArray(jsonData.userRoles)) {
                  // Thêm userRoles mặc định (role = 4: member) cho các thành viên mới nếu chưa có
                  for (const newMember of newMembers) {
                    const existingRole = jsonData.userRoles.find(
                      (ur: any) => String(ur.userId) === String(newMember.id)
                    );
                    if (!existingRole) {
                      jsonData.userRoles.push({
                        userId: newMember.id,
                        roles: [4], // Default role: member
                      });
                    }
                  }
                  channel.json_data = jsonData;
                }
              } catch (error) {
                console.error('Error updating json_data with new members:', error);
              }
            }
          }
        }

        // Xóa thành viên (admin có thể xóa cả owner, cho cả group và group-private)
        if (data.removeUserIds && Array.isArray(data.removeUserIds) && data.removeUserIds.length > 0) {
          if (channel.type !== 'group' && channel.type !== 'group-private') {
            throw new RpcException({
              msg: 'Chỉ có thể xóa thành viên khỏi kênh group hoặc group-private',
              status: 400,
            });
          }
          const removeIdSet = new Set(data.removeUserIds.map(String));
          channel.users = channel.users.filter(
            (u: any) => !removeIdSet.has(String(u.id)),
          );
          channel.member_count = channel.users.length;

          // Nếu là group-private và có json_data.userRoles, cần xóa roles của members đã xóa
          if (channel.type === 'group-private' && channel.json_data) {
            try {
              const jsonData = typeof channel.json_data === 'string'
                ? JSON.parse(channel.json_data)
                : channel.json_data;

              if (jsonData.userRoles && Array.isArray(jsonData.userRoles)) {
                // Xóa userRoles của các thành viên đã bị xóa
                jsonData.userRoles = jsonData.userRoles.filter(
                  (ur: any) => !removeIdSet.has(String(ur.userId))
                );
                channel.json_data = jsonData;
              }
            } catch (error) {
              console.error('Error updating json_data after removing members:', error);
            }
          }

          // FIX: Kiểm tra channel.owner trước khi truy cập thuộc tính
          if (channel.owner) {
            const ownerRemoved = data.removeUserIds.some(
              (id: any) => String(id) === String(channel.owner.id)
            );
            
            if (ownerRemoved) {
              // Gán owner mới là user đầu tiên còn lại
              if (channel.users.length > 0) {
                channel.owner = channel.users[0];
              } else {
                channel.owner = null;
              }
            }
          }

          if (channel.users.length < 2 && channel.type !== 'personal') {
            throw new RpcException({
              msg: 'Kênh phải có ít nhất 2 thành viên',
              status: 400,
            });
          }
        }

        await this.channelRepo.save(channel);

        // Lấy lại với relations
        const updated: any = await this.channelRepo.findOne({
          where: { id: data.channelId },
          relations: ['users', 'owner'],
        });

        return {
          id: updated.id,
          name: updated.name,
          type: updated.type,
          key: updated.key,
          json_data: updated.json_data,
          member_count: updated.member_count,
          owner: updated.owner
            ? this.remove_field_user({ ...updated.owner })
            : null,
          members: (updated.users || []).map((u: any) =>
            this.remove_field_user({
              ...u,
              avatar: u.avatar ?? u.github_avatar ?? null,
            }),
          ),
          created_at: updated.created_at,
          updated_at: updated.updated_at,
        };
      }

      case 'delete': {
        // Xóa channel (Admin có toàn quyền xóa bất kỳ channel nào)
        // data.channelId: string (required)
        // data.hard?: boolean (true: xóa vĩnh viễn kể cả messages, false: chỉ xóa channel)

        if (!data.id) {
          throw new RpcException({
            msg: 'Thiếu id',
            status: 400,
          });
        }

        const channel = await this.channelRepo.findOne({
          where: { id: data.id },
          relations: ['users', 'messages', 'repositories'],
        });

        if (!channel) {
          throw new RpcException({
            msg: 'Không tìm thấy channel',
            status: 404,
          });
        }

        const channelInfo = {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          member_count: channel.member_count,
        };

        // Hard delete: xóa cả messages và channel
        if (data.hard === true) {
          // Đếm số messages trước khi xóa
          const messageCount = await this.messageRepo.count({
            where: { channel: { id: channel.id } },
          });

          // Xóa tất cả messages
          await this.messageRepo.delete({ channel: { id: channel.id } });

          // Xóa channel
          await this.channelRepo.remove(channel);

          return {
            msg: 'Đã xóa vĩnh viễn channel và tất cả tin nhắn',
            channelId: data.channelId,
            channelInfo,
            deletedMessages: messageCount,
          };
        } else {
          // Soft delete: chỉ xóa channel (giữ messages cho audit)
          await this.channelRepo.remove(channel);

          return {
            msg: 'Đã xóa channel (giữ lại tin nhắn)',
            channelId: data.channelId,
            channelInfo,
          };
        }
      }

      case 'toggle-active': {
        // Bật/tắt trạng thái isActive của channel
        // data.channelId: string (required)

        if (!data.id) {
          throw new RpcException({
            msg: 'Thiếu channelId',
            status: 400,
          });
        }

        const channel: any = await this.channelRepo.findOne({
          where: { id: data.id },
          relations: ['users', 'owner'],
        });

        if (!channel) {
          throw new RpcException({
            msg: 'Không tìm thấy channel',
            status: 404,
          });
        }

        // Đảo trạng thái isActive
        channel.isActive = !channel.isActive;
        await this.channelRepo.save(channel);

        return {
          msg: `Đã ${channel.isActive ? 'kích hoạt' : 'vô hiệu hóa'} kênh`,
          channelId: channel.id,
          isActive: channel.isActive,
          name: channel.name,
          type: channel.type,
        };
      }

      case 'stats': {
        // Thống kê tổng quan về channels
        const totalChannels = await this.channelRepo.count();
        const personalChannels = await this.channelRepo.count({
          where: { type: 'personal' },
        });
        const groupChannels = await this.channelRepo.count({
          where: { type: 'group' },
        });
        const privateChannels = await this.channelRepo.count({
          where: { type: 'group-private' },
        });
        const totalMessages = await this.messageRepo.count();

        // Lấy tất cả channels với owner và messages
        const allChannels = await this.channelRepo.find({
          relations: ['owner', 'messages'],
        });

        // Đếm số messages cho mỗi channel và sắp xếp
        const channelsWithCount = allChannels.map((ch: any) => ({
          channel: ch,
          messageCount: ch.messages?.length || 0,
        }));

        // Sắp xếp theo số lượng tin nhắn giảm dần và lấy top 5
        channelsWithCount.sort((a, b) => b.messageCount - a.messageCount);
        const top5 = channelsWithCount.slice(0, 5);

        return {
          totalChannels,
          personalChannels,
          groupChannels,
          privateChannels,
          totalMessages,
          topChannels: top5.map((item: any) => ({
            id: item.channel.id,
            name: item.channel.name,
            type: item.channel.type,
            member_count: item.channel.member_count,
            messageCount: item.messageCount,
            owner: item.channel.owner ? this.remove_field_user({ ...item.channel.owner }) : null,
          })),
        };
      }

      case 'delete-message-channel': {
        // Xóa tin nhắn trong channel (Admin có toàn quyền)
        // data.messageId: string (required)
        // data.channelId?: string (optional, để verify)

        if (!data.messageId) {
          throw new RpcException({
            msg: 'Thiếu messageId',
            status: 400,
          });
        }

        const message = await this.messageRepo.findOne({
          where: { id: data.messageId },
          relations: ['channel', 'sender', 'attachments'],
        });

        if (!message) {
          throw new RpcException({
            msg: 'Không tìm thấy tin nhắn',
            status: 404,
          });
        }

        // Verify channelId nếu có
        if (data.channelId && String(message.channel?.id) !== String(data.channelId)) {
          throw new RpcException({
            msg: 'Tin nhắn không thuộc channel này',
            status: 400,
          });
        }

        const messageInfo = {
          id: message.id,
          text: message.text,
          type: message.type,
          channelId: message.channel?.id || null,
          channelName: message.channel?.name || null,
          senderId: message.sender?.id || null,
          senderUsername: message.sender?.username || null,
          send_at: message.send_at,
          attachmentCount: message.attachments?.length || 0,
        };

        // Xóa tin nhắn (attachments sẽ được xóa tự động nếu có cascade)
        await this.messageRepo.remove(message);

        return {
          msg: 'Đã xóa tin nhắn thành công',
          messageInfo,
        };
      }


      default:
        throw new RpcException({
          msg: 'Method không hợp lệ',
          status: 400,
        });
    }
  }
}
