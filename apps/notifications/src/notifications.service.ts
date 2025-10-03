import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from '@myorg/schemas';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel, User } from '@myorg/entities';
import { RpcCustomException } from '@myorg/common';
import { log } from 'console';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
    @InjectRepository(Channel)
    private channelRepository: Repository<Channel>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  //Helpers

  private async getChannelMembers(channelId: string | number) {
    if (!channelId) return [];
    const channel = await this.channelRepository.findOne({
      where: { id: channelId as any },
      relations: ['users'],
    });
    return (channel?.users || []).map((u) => ({
      id: String(u.id),
      username: (u as any).username,
      email: (u as any).email,
    }));
  }

  // Tạo notification mới
  async createNotification(data: any, type = 'message'): Promise<any> {
    switch (type) {
      case 'message':
        return this.createMessageNotification(data);
      case 'github':
        return this.createGitHubNotification(data);
      default:
        throw new RpcCustomException(`Unsupported notification type: ${type}`);
    }
  }

  // Tạo notification mới cho tin nhắn
  private async createMessageNotification(data: any): Promise<any> {
    const channelId = data?.channel?.id;
    const senderId = data?.sender?.id;

    const members = (await this.getChannelMembers(channelId))
      .filter((m) => m.id !== String(senderId))
      .map((m) => m.id);

    const savedNotifications = [];

    for (const member of members) {
      const notification = new this.notificationModel({
        userId: member,
        type: 'message',
        data: data,
        read: false,
        createdAt: new Date(),
      });
      const savedNotification = await notification.save();
      savedNotifications.push(savedNotification);
    }

    return {
      notifications: savedNotifications,
    };
  }

  private async createGitHubNotification(data: any): Promise<any> {
    const installationId = data?.installationId || data?.installation?.id;
    console.log('GitHub installationId:', installationId);

    const user: any = await this.userRepository.findOneBy({
      github_installation_id: installationId,
    });
    console.log('User found:', user);

    const savedNotifications = [];
    const notification = new this.notificationModel({
      userId: user.id,
      type: 'github',
      data: data,
      read: false,
      createdAt: new Date(),
    });
    const savedNotification = await notification.save();
    savedNotifications.push(savedNotification);

    return {
      notifications: savedNotifications,
    };
  }

  // Lấy tất cả notification của user
  async getNotificationsForUser(
    userId: string,
    query: {
      page?: number;
      limit?: number;
      read?: boolean;
      type?: string;
    } = {},
  ): Promise<{ notifications: Notification[]; total: number }> {
    try {
      const filter: any = { userId };
      if (query.read !== undefined) {
        filter.read = query.read;
      }
      if (query.type !== undefined) {
        filter.type = query.type;
      }

      const page = query.page || 1;
      const limit = query.limit || 10;
      const skip = (page - 1) * limit;

      const [notifications, total] = await Promise.all([
        this.notificationModel
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .exec(),
        this.notificationModel.countDocuments(filter).exec(),
      ]);

      return { notifications, total };
    } catch (error: any) {
      this.logger.error(
        `Error getting notifications for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // Đánh dấu notification đã đọc
  async markAsRead(notificationId: string): Promise<Notification> {
    try {
      const notification = await this.notificationModel
        .findByIdAndUpdate(notificationId, { read: true }, { new: true })
        .exec();

      if (!notification) {
        throw new Error(`Notification with ID ${notificationId} not found`);
      }

      this.logger.log(`Marked notification ${notificationId} as read`);
      return notification;
    } catch (error: any) {
      this.logger.error(
        `Error marking notification ${notificationId} as read: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // Đánh dấu tất cả notification của user là đã đọc
  async markAllAsRead(userId: string): Promise<number> {
    try {
      const result = await this.notificationModel
        .updateMany({ userId, read: false }, { read: true })
        .exec();

      this.logger.log(
        `Marked ${result.modifiedCount} notifications as read for user ${userId}`,
      );
      return result.modifiedCount;
    } catch (error: any) {
      this.logger.error(
        `Error marking all notifications as read for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // Xử lý thông báo tin nhắn mới
  // async processMessageNotification(messageData: any): Promise<Notification> {
  //   try {
  //     // Xác định người nhận thông báo (không gửi thông báo cho người gửi tin nhắn)
  //     const recipients =
  //       messageData.channel?.members
  //         .filter((member) => member.id !== messageData.sender.id)
  //         .map((member) => member.id) || [];

  //     // Tạo thông báo cho từng người nhận
  //     const promises = recipients.map((recipientId) =>
  //       this.createNotification({
  //         userId: recipientId,
  //         type: 'message',
  //         data: {
  //           messageId: messageData.id,
  //           channelId: messageData.channel?.id,
  //           senderId: messageData.sender.id,
  //           senderName: messageData.sender.username,
  //           content: messageData.text,
  //           timestamp: messageData.created_at || new Date(),
  //         },
  //       }),
  //     );

  //     const results = await Promise.all(promises);
  //     this.logger.log(`Created ${results.length} message notifications`);

  //     // Trả về thông báo đầu tiên hoặc null nếu không có người nhận
  //     return results[0] || null;
  //   } catch (error) {
  //     this.logger.error(
  //       `Error processing message notification: ${error.message}`,
  //       error.stack,
  //     );
  //     throw error;
  //   }
  // }

  // API endpoint để xử lý notification từ Kafka
  // async send_message_notification(data: any) {
  //   try {
  //     const notification = await this.processMessageNotification(data);
  //     return { success: true, notification };
  //   } catch (error) {
  //     this.logger.error(
  //       `Error in send_message_notification: ${error.message}`,
  //       error.stack,
  //     );
  //     throw error;
  //   }
  // }
}
