// libs/entities/src/attachment.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Message } from './message.entity';

export type AttachmentType = 'image' | 'video' | 'file' | 'audio';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  url: string; // link đến Cloudflare R2/Images/CDN

  @Column({ type: 'varchar', length: 50 })
  type: AttachmentType; // loại file: image, video, file,...

  @Column({ nullable: true })
  filename?: string; // tên gốc của file

  @ManyToOne(() => Message, (message) => message.attachments, {
    onDelete: 'CASCADE',
  })
  message: Message;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
