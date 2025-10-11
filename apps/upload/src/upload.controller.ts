import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UploadService } from './upload.service';

@Controller()
export class UploadController {
  constructor(private readonly UploadService: UploadService) {}

  // Nhận message từ Gateway qua Kafka
  @MessagePattern('svc.upload.exec')
  async handleUploadMessage(@Payload() payload: any) {
    switch (payload.cmd) {
      case 'getPresignedUrl':
        return await this.UploadService.getPresignedUrl(
          payload.data.filename,
          payload.data.contentType,
          payload.data.user.id,
        );
      case 'getObject':
        return await this.UploadService.getObject(payload.data.key);
      case 'getAttachmentsByChannel':
        console.log('upload controller', payload.data);
        return await this.UploadService.getAttachmentsByChannel(payload.data);
      default:
        return { error: 'Unknown command' };
    }
  }
}
