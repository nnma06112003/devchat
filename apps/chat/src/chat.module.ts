import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from 'libs/database/src/database.module';
import { Message, Channel, User, Attachment, Repository } from '@myorg/entities';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [
    DatabaseModule, // kết nối DB chung
    TypeOrmModule.forFeature([Message, Channel, User, Attachment,Repository]), // khai báo entity riêng service này dùng
  ],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
