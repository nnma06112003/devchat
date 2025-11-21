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
    enum: ['message','reply-message','remove','notification', 'system','code-share','file-upload','code-card','tool','ba-require','tester-report'],
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

  @Column({ type: 'jsonb', nullable: true })
  json_data?: any;

  @Column({ type: 'boolean', default: false })
  isPin: boolean;

  @Column({ type: 'jsonb', nullable: true })
  replyTo?: any;

  @Column({ type: 'jsonb', nullable: true })
  like_data?: any;

  @OneToMany(() => Attachment, (a) => a.message, { cascade: true })
  attachments: Attachment[];

  @Column({ type: 'timestamp', nullable: true })
  send_at?: Date;
  
  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

}
