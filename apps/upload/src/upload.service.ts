// apps/gateway/src/upload/upload.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Attachment, Sheet, User } from '@myorg/entities';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class UploadService {
  private s3: S3Client;
  private bucket = process.env.CF_BUCKET!;

  constructor(
    @InjectRepository(Attachment)
    private attachmentRepo: Repository<Attachment>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Sheet)
    private sheetRepo: Repository<Sheet>,
  ) {
    this.s3 = new S3Client({
      region: 'auto', // Cloudflare R2 không cần region thật
      endpoint: process.env.CF_ENDPOINT, // ví dụ: https://<accountid>.r2.cloudflarestorage.com
      credentials: {
        accessKeyId: process.env.CF_ACCESS_KEY!,
        secretAccessKey: process.env.CF_SECRET_KEY!,
      },
    });
    this.setupCORS();
  }

  private publicURL = process.env.PUBLIC_URL || '';

  private async setupCORS() {
    try {
      const corsConfiguration = {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            AllowedOrigins: [
              'http://localhost:8080',
              'http://localhost:3088',
              'https://thaibinhduong1802.id.vn',
            ],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000,
          },
        ],
      };

      const command = new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: corsConfiguration,
      });

      await this.s3.send(command);
      console.log('CORS configuration updated successfully');
    } catch (error) {
      console.error('Failed to set CORS configuration:', error);
    }
  }

  async getPresignedUrl(filename: string, contentType: string, userId: string) {
    const key = `uploads/${userId}/${Date.now()}-${filename}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 60 }); // 60 giây

    const fileUrl = `${this.publicURL}/${key}`; // link public qua CDN

    return { uploadUrl, fileUrl, key };
  }

  //Get object từ R2
  async getObject(key: string) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3, command, { expiresIn: 60 });
    return url;
  }

  //Get object by channel
  async getAttachmentsByChannel(params: {
    channelId: number | string;
    limit?: number;
    cursor?: number; // attachment.id để cursor-based pagination
    filename?: string;
    mimeType?: string;
    senderId?: number | string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const {
      channelId,
      limit = 20,
      cursor,
      filename,
      mimeType,
      senderId,
      startDate,
      endDate,
    } = params;

    const qb: SelectQueryBuilder<Attachment> = this.attachmentRepo
      .createQueryBuilder('attachment')
      .leftJoinAndSelect('attachment.message', 'message')
      .leftJoinAndSelect('message.channel', 'channel')
      .leftJoin('message.sender', 'sender')
      .addSelect(['sender.id', 'sender.username', 'sender.email'])
      .where('channel.id = :channelId', { channelId })
      .orderBy('attachment.created_at', 'DESC')
      .addOrderBy('attachment.id', 'DESC') // tie-breaker cho cursor
      .limit(limit);

    // Cursor-based pagination (load more khi scroll)
    if (cursor) {
      qb.andWhere('attachment.id < :cursor', { cursor });
    }

    // Filter by filename (search)
    if (filename) {
      qb.andWhere('attachment.filename ILIKE :filename', {
        filename: `%${filename}%`,
      });
    }

    // Filter by mimeType
    if (mimeType) {
      qb.andWhere('attachment.mimeType ILIKE :mimeType', {
        mimeType: `%${mimeType}%`,
      });
    }

    // Filter by sender
    if (senderId) {
      qb.andWhere('sender.id = :senderId', { senderId });
    }

    // Filter by date range
    if (startDate) {
      qb.andWhere('attachment.created_at >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('attachment.created_at <= :endDate', { endDate });
    }

    const attachments = await qb.getMany();

    // Trả về cursor mới (id của item cuối) để FE dùng cho lần load tiếp
    const nextCursor =
      attachments.length === limit
        ? attachments[attachments.length - 1].id
        : null;

    return {
      attachments,
      nextCursor,
      hasMore: attachments.length === limit,
    };
  }

  async getAvatarPresignedUrl(
    userId: string,
    filename: string,
    contentType: string,
  ) {
    const key = `avatars/${userId}/${Date.now()}-${filename}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ACL: 'public-read',
    });

    const avatarUrl = `${this.publicURL}/${key}`;

    const signedUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    if (key && userId) {
      this.userRepo.update(userId, { avatar: avatarUrl });
    }
    return { signedUrl, key };
  }

  async getSheetUrl(channelId: number | string) {
    try {
      let sheet = await this.sheetRepo.findOne({
        where: { channel: { id: channelId } },
      });

      // Generate key nếu chưa tồn tại
      if (!sheet) {
        const r2Key = `sheets/${channelId}/${Date.now()}-sheet.json`;
        const sheetUrl = `${this.publicURL}/${r2Key}`;

        sheet = this.sheetRepo.create({
          channel: { id: channelId } as any,
          sheetKey: r2Key,
          sheetUrl,
        });

        await this.sheetRepo.save(sheet);
      }

      // Tạo signed URL để client PUT nội dung file
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: sheet.sheetKey,
        ContentType: 'application/json',
      });

      const signedUrl = await getSignedUrl(this.s3, command, {
        expiresIn: 3600,
      });

      return {
        signedUrl,
        sheetUrl: sheet.sheetUrl,
      };
    } catch (err) {
      console.error('getSheetUrl error: ', err);
      throw new InternalServerErrorException('Could not generate sheet URL');
    }
  }

  /**
   * Quản lý file của user - hỗ trợ nhiều operations
   * @param userId ID của user
   * @param method Phương thức: 'list' | 'search' | 'filter' | 'unlink' | 'list-channels-with-files'
   * @param data Dữ liệu cho từng method
   */
  async manageUserFiles(
    userId: string | number,
    method: 'list' | 'search' | 'filter' | 'unlink' | 'list-channels-with-files',
    data: {
      // Common params
      limit?: number;
      cursor?: number;
      
      // Search params
      filename?: string;
      
      // Filter params
      channelId?: number | string;
      mimeType?: string;
      minSize?: number;
      maxSize?: number;
      startDate?: Date;
      endDate?: Date;
      
      // Unlink params
      attachmentId?: number | string;
      messageId?: number | string;
    },
  ) {
    switch (method) {
      case 'list':
        return this.listUserFiles(userId, data);
      
      case 'search':
        return this.searchUserFiles(userId, data);
      
      case 'filter':
        return this.filterUserFiles(userId, data);
      
      case 'unlink':
        return this.unlinkFile(userId, data);
      
      case 'list-channels-with-files':
        return this.listChannelsWithFiles(userId, data);
      
      default:
        throw new Error(`Invalid method: ${method}`);
    }
  }

  /**
   * Case 1: Liệt kê tất cả file của user
   */
  private async listUserFiles(
    userId: string | number,
    data: { limit?: number; cursor?: number },
  ) {
    const { limit = 50, cursor } = data;

    const qb = this.attachmentRepo
      .createQueryBuilder('attachment')
      .leftJoinAndSelect('attachment.message', 'message')
      .leftJoinAndSelect('message.channel', 'channel')
      .leftJoin('message.sender', 'sender')
      .addSelect(['sender.id', 'sender.username', 'sender.email'])
      .where('sender.id = :userId', { userId })
      .orderBy('attachment.created_at', 'DESC')
      .addOrderBy('attachment.id', 'DESC')
      .limit(limit);

    if (cursor) {
      qb.andWhere('attachment.id < :cursor', { cursor });
    }

    const attachments = await qb.getMany();

    const formattedFiles = attachments.map((att) => ({
      id: att.id,
      filename: att.filename,
      fileUrl: att.fileUrl,
      mimeType: att.mimeType,
      fileSize: att.fileSize,
      key: att.key,
      created_at: att.created_at,
      channel: att.message?.channel
        ? {
            id: att.message.channel.id,
            name: att.message.channel.name,
            type: att.message.channel.type,
          }
        : null,
      message: att.message
        ? {
            id: att.message.id,
            text: att.message.text,
            send_at: att.message.send_at,
          }
        : null,
    }));

    const nextCursor =
      attachments.length === limit
        ? attachments[attachments.length - 1].id
        : null;

    return {
      files: formattedFiles,
      total: formattedFiles.length,
      nextCursor,
      hasMore: attachments.length === limit,
    };
  }

  /**
   * Case 2: Tìm kiếm file theo tên
   */
  private async searchUserFiles(
    userId: string | number,
    data: { filename?: string; limit?: number; cursor?: number },
  ) {
    const { filename, limit = 50, cursor } = data;

    if (!filename) {
      throw new Error('Filename is required for search');
    }

    const qb = this.attachmentRepo
      .createQueryBuilder('attachment')
      .leftJoinAndSelect('attachment.message', 'message')
      .leftJoinAndSelect('message.channel', 'channel')
      .leftJoin('message.sender', 'sender')
      .addSelect(['sender.id', 'sender.username', 'sender.email'])
      .where('sender.id = :userId', { userId })
      .andWhere('attachment.filename ILIKE :filename', {
        filename: `%${filename}%`,
      })
      .orderBy('attachment.created_at', 'DESC')
      .addOrderBy('attachment.id', 'DESC')
      .limit(limit);

    if (cursor) {
      qb.andWhere('attachment.id < :cursor', { cursor });
    }

    const attachments = await qb.getMany();

    const formattedFiles = attachments.map((att) => ({
      id: att.id,
      filename: att.filename,
      fileUrl: att.fileUrl,
      mimeType: att.mimeType,
      fileSize: att.fileSize,
      key: att.key,
      created_at: att.created_at,
      channel: att.message?.channel
        ? {
            id: att.message.channel.id,
            name: att.message.channel.name,
            type: att.message.channel.type,
          }
        : null,
      message: att.message
        ? {
            id: att.message.id,
            text: att.message.text,
            send_at: att.message.send_at,
          }
        : null,
    }));

    const nextCursor =
      attachments.length === limit
        ? attachments[attachments.length - 1].id
        : null;

    return {
      files: formattedFiles,
      total: formattedFiles.length,
      searchQuery: filename,
      nextCursor,
      hasMore: attachments.length === limit,
    };
  }

  /**
   * Case 3: Filter file theo nhiều tiêu chí
   */
  private async filterUserFiles(
    userId: string | number,
    data: {
      channelId?: number | string;
      mimeType?: string;
      minSize?: number;
      maxSize?: number;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      cursor?: number;
    },
  ) {
    const {
      channelId,
      mimeType,
      minSize,
      maxSize,
      startDate,
      endDate,
      limit = 50,
      cursor,
    } = data;

    // Build where condition
    const whereCondition: any = {
      message: {
        sender: { id: userId },
      },
    };

    // Lấy tất cả attachments của user
    const allAttachments = await this.attachmentRepo.find({
      where: whereCondition,
      relations: ['message', 'message.channel', 'message.sender'],
      order: {
        created_at: 'DESC',
        id: 'DESC',
      },
    });

    // Filter trong JavaScript
    let filteredAttachments = allAttachments.filter((att) => {
      // Filter by cursor (pagination)
      if (cursor && att.id >= cursor) {
        return false;
      }

      // Filter by channel
      if (channelId !== undefined && channelId !== null && channelId !== '') {
        if (!att.message?.channel || att.message.channel.id != channelId) {
          return false;
        }
      }

      // Filter by mimeType
      if (mimeType) {
        if (!att.mimeType || !att.mimeType.toLowerCase().includes(mimeType.toLowerCase())) {
          return false;
        }
      }

      // Filter by file size range
      if (minSize !== undefined && att.fileSize !== undefined && att.fileSize < minSize) {
        return false;
      }
      if (maxSize !== undefined && att.fileSize !== undefined && att.fileSize > maxSize) {
        return false;
      }

      // Filter by date range
      if (startDate && att.created_at < startDate) {
        return false;
      }
      if (endDate && att.created_at > endDate) {
        return false;
      }

      return true;
    });

    // Limit results
    const attachments = filteredAttachments.slice(0, limit);

    // Format results
    const formattedFiles = attachments.map((att) => ({
      id: att.id,
      filename: att.filename,
      fileUrl: att.fileUrl,
      mimeType: att.mimeType,
      fileSize: att.fileSize,
      key: att.key,
      created_at: att.created_at,
      channel: att.message?.channel
        ? {
            id: att.message.channel.id,
            name: att.message.channel.name,
            type: att.message.channel.type,
          }
        : null,
      message: att.message
        ? {
            id: att.message.id,
            text: att.message.text,
            send_at: att.message.send_at,
          }
        : null,
    }));

    const nextCursor =
      attachments.length === limit
        ? attachments[attachments.length - 1].id
        : null;

    return {
      files: formattedFiles,
      total: formattedFiles.length,
      filters: {
        channelId,
        mimeType,
        minSize,
        maxSize,
        startDate,
        endDate,
      },
      nextCursor,
      hasMore: attachments.length === limit,
    };
  }

  /**
   * Case 4: Xóa liên kết file khỏi message/channel
   * - Chỉ xóa attachment record trong DB
   * - Không xóa file trên R2 (vẫn giữ để recovery nếu cần)
   */
  private async unlinkFile(
    userId: string | number,
    data: {
      attachmentId?: number | string;
      messageId?: number | string;
    },
  ) {
    const { attachmentId, messageId } = data;

    if (!attachmentId && !messageId) {
      throw new Error('Either attachmentId or messageId is required');
    }

    // Xóa theo attachmentId
    if (attachmentId) {
      const attachment = await this.attachmentRepo.findOne({
        where: { id: Number(attachmentId) },
        relations: ['message', 'message.sender'],
      });

      if (!attachment) {
        throw new Error(`Attachment ${attachmentId} not found`);
      }

      // Kiểm tra quyền: chỉ owner của message mới được xóa
      // if (String(attachment.message.sender.id) !== String(userId)) {
      //   throw new Error('You do not have permission to unlink this file');
      // }

      await this.attachmentRepo.remove(attachment);

      return {
        success: true,
        message: 'File unlinked successfully',
        unlinkedFile: {
          id: attachment.id,
          filename: attachment.filename,
          key: attachment.key,
        },
      };
    }

    // Xóa tất cả attachments của message
    if (messageId) {
      const attachments = await this.attachmentRepo.find({
        where: { message: { id: Number(messageId) } },
        relations: ['message', 'message.sender'],
      });

      if (attachments.length === 0) {
        throw new Error(`No attachments found for message ${messageId}`);
      }

      // Kiểm tra quyền
      const firstAttachment = attachments[0];
      if (String(firstAttachment.message.sender.id) !== String(userId)) {
        throw new Error(
          'You do not have permission to unlink files from this message',
        );
      }

      await this.attachmentRepo.remove(attachments);

      return {
        success: true,
        message: 'All files unlinked successfully',
        unlinkedFiles: attachments.map((att) => ({
          id: att.id,
          filename: att.filename,
          key: att.key,
        })),
        count: attachments.length,
      };
    }
  }

  /**
   * Case 5: Liệt kê các channel có file của user
   * Trả về danh sách channels và số lượng file trong mỗi channel
   */
  private async listChannelsWithFiles(
    userId: string | number,
    data: { limit?: number; cursor?: number },
  ) {
    const { limit = 50, cursor } = data;

    // Sử dụng repository find với relations thay vì query builder
    const whereCondition: any = {
      message: {
        sender: { id: userId },
        channel: { id: cursor ? { $lt: cursor } : undefined },
      },
    };

    // Nếu không có cursor, bỏ điều kiện id
    if (!cursor) {
      delete whereCondition.message.channel.id;
    }

    // Lấy tất cả attachments của user có channel
    const attachments = await this.attachmentRepo.find({
      where: {
        message: {
          sender: { id: userId },
        },
      },
      relations: ['message', 'message.channel', 'message.sender'],
      order: {
        created_at: 'DESC',
      },
    });

    // Filter ra những attachment có channel
    const validAttachments = attachments.filter(
      (att) => att.message?.channel?.id,
    );

    // Nhóm theo channel và đếm số lượng file
    const channelMap = new Map<
      number,
      {
        channelId: number | string;
        channelName: string;
        channelType: string;
        fileCount: number;
        lastFileDate: Date;
      }
    >();

    for (const att of validAttachments) {
      const channelId = Number(att.message.channel.id);
      
      if (channelMap.has(channelId)) {
        const existing = channelMap.get(channelId)!;
        existing.fileCount += 1;
        
        // Cập nhật lastFileDate nếu attachment hiện tại mới hơn
        if (att.created_at > existing.lastFileDate) {
          existing.lastFileDate = att.created_at;
        }
      } else {
        channelMap.set(channelId, {
          channelId: att.message.channel.id,
          channelName: att.message.channel.name,
          channelType: att.message.channel.type,
          fileCount: 1,
          lastFileDate: att.created_at,
        });
      }
    }

    // Chuyển Map thành array và sắp xếp theo lastFileDate
    let channels = Array.from(channelMap.values()).sort(
      (a, b) => b.lastFileDate.getTime() - a.lastFileDate.getTime(),
    );

    // Áp dụng cursor pagination
    if (cursor) {
      const cursorNum = Number(cursor);
      channels = channels.filter((ch) => Number(ch.channelId) < cursorNum);
    }

    // Giới hạn số lượng kết quả
    channels = channels.slice(0, limit);

    const nextCursor =
      channels.length === limit
        ? channels[channels.length - 1].channelId
        : null;

    return {
      channels,
      total: channels.length,
      nextCursor,
      hasMore: channels.length === limit,
    };
  }
}
