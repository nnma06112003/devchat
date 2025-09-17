import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from 'libs/database/src/database.module';
import { Message , Channel, User } from '@myorg/entities';
import { GitService } from './git.service';
import { GitController } from './git.controller';

@Module({
  imports: [
    DatabaseModule,                 // kết nối DB chung
    TypeOrmModule.forFeature([Message, Channel, User]) // khai báo entity riêng service này dùng
  ],
  providers: [GitService],
  controllers: [GitController],
})
export class GitModule {}
