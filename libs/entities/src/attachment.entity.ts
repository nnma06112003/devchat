// libs/entities/src/attachment.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Message } from './message.entity';

export type AttachmentType = 'image' | 'video' | 'file' | 'audio';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  fileUrl: string; // link đến Cloudflare R2/Images/CDN

  @Column()
  mimeType: string; // loại file: image, video, file,...

  @Column()
  key: string;

  @Column({ nullable: true })
  filename?: string; // tên gốc của file

  @Column({ nullable: true })
  fileSize?: number; // kích thước file

  @ManyToOne(() => Message, (message) => message.attachments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'messageId' })
  message: Message;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
