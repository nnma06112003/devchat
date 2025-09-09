import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Message, User } from '@myorg/entities';
import { Channel } from '@myorg/entities';
import { BaseService } from '@myorg/common';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class UploadService extends BaseService<Message | Channel> {
  /**
   * Tham gia kênh Upload
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


 

  // Gửi tin nhắn vào channel
async uploadFile(user: any, data: { channelId: string; text: string; send_at: any }) {
  const channel = await this.check_exist_with_data(
    Channel,
    { id: data.channelId },
    'Kênh Upload không tồn tại',
  );
  const sender = await this.check_exist_with_data(User, { id: user.id }, 'Người gửi không tồn tại');
  if (!channel) throw new RpcException({ msg: 'Kênh Upload không tồn tại', status: 404 });
  
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




}
