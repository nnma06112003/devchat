import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Message, User } from '@myorg/entities';
import { Channel } from '@myorg/entities';
import { BaseService } from '@myorg/common';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class GitService extends BaseService<Message | Channel> {
  /**
   * Tham gia kênh Git
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


  async ListRepo(user: any, data: { id: string, type: string }) {
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
        name: 'Personal Git',
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



}
