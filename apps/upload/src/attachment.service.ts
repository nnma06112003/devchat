// apps/gateway/src/attachment/attachment.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment, AttachmentType, Message } from '@myorg/entities';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

@Injectable()
export class AttachmentService {
  private s3: S3Client;
  private bucket = process.env.CF_BUCKET!;

  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.CF_ENDPOINT, // ví dụ: https://<accountid>.r2.cloudflarestorage.com
      credentials: {
        accessKeyId: process.env.CF_ACCESS_KEY!,
        secretAccessKey: process.env.CF_SECRET_KEY!,
      },
    });
  }

  /**
   * Upload file binary trực tiếp lên Cloudflare R2 và tạo attachment
   * @param params { buffer, mimetype, filename, type, messageId, userId }
   */
  async uploadAndCreateAttachment(params: {
    buffer: Buffer;
    mimetype: string;
    filename: string;
    type: AttachmentType;
    messageId: number | string;
    userId: string;
  }) {
    const message = await this.messageRepo.findOne({
      where: { id: params.messageId },
    });
    if (!message) throw new Error('Message not found');

    // Tạo key duy nhất trong bucket
    const key = `uploads/${params.userId}/${Date.now()}-${randomUUID()}-${params.filename}`;

    // Upload lên R2
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: params.buffer,
        ContentType: params.mimetype,
      }),
    );

    // Public URL (qua CDN hoặc endpoint gốc)
    const fileUrl = `${process.env.CDN_URL}/${key}`;

    // Lưu DB
    const attachment = this.attachmentRepo.create({
      url: fileUrl,
      type: params.type,
      filename: params.filename,
      message,
    });
    return await this.attachmentRepo.save(attachment);
  }

  /**
   * Tạo attachment từ URL đã có (ví dụ: presigned upload xong)
   */
  async createAttachment(params: {
    url: string;
    type: AttachmentType;
    filename?: string;
    messageId: number | string;
  }) {
    const message = await this.messageRepo.findOne({
      where: { id: params.messageId },
    });
    if (!message) throw new Error('Message not found');

    const attachment = this.attachmentRepo.create({
      url: params.url,
      type: params.type,
      filename: params.filename,
      message,
    });
    return await this.attachmentRepo.save(attachment);
  }
}
