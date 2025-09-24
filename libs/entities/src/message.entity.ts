// libs/entities/src/message.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from './channel.entity';
import { User } from './user.entity';
import { Attachment } from './attachment.entity';



@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id: number | string;

  @Column({
    type: 'enum',
    enum: ['message', 'notification', 'system'],
    default: 'message',
  })
  type: string;

  @Column('text', { nullable: true })
  text: string;

  @ManyToOne(() => Channel, (channel) => channel.messages, {
    onDelete: 'CASCADE',
  })
  channel: Channel;

  @ManyToOne(() => User, { nullable: false, onDelete: 'SET NULL' })
  sender: User;

  @OneToMany(() => Attachment, (a) => a.message, { cascade: true })
  attachments: Attachment[];

  @Column({ type: 'timestamp', nullable: true })
  send_at?: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

}
