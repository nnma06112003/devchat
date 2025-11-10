// apps/gateway/src/upload/upload.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Attachment, User } from '@myorg/entities';
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

    const fileUrl = `${process.env.CDN_URL}/${key}`; // link public qua CDN

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

    const signedUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    if (key && userId) {
      this.userRepo.update(userId, { avatar: key });
    }
    return { signedUrl, key };
  }
}
