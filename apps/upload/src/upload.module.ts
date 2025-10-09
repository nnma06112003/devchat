import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from 'libs/database/src/database.module';
import { Message, Channel, User, Attachment } from '@myorg/entities';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';

@Module({
  imports: [
    DatabaseModule, // kết nối DB chung
    TypeOrmModule.forFeature([Attachment, Message, Channel, User]), // khai báo entity riêng service này dùng
  ],
  providers: [UploadService],
  controllers: [UploadController],
})
export class UploadModule {}
