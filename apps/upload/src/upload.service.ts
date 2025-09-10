// apps/gateway/src/upload/upload.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class UploadService {
  private s3: S3Client;
  private bucket = process.env.CF_BUCKET!;

  constructor() {
    this.s3 = new S3Client({
      region: 'auto', // Cloudflare R2 không cần region thật
      endpoint: process.env.CF_ENDPOINT, // ví dụ: https://<accountid>.r2.cloudflarestorage.com
      credentials: {
        accessKeyId: process.env.CF_ACCESS_KEY!,
        secretAccessKey: process.env.CF_SECRET_KEY!,
      },
    });
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


  
}
