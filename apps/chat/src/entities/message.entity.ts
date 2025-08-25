import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import { Channel } from './channel.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  senderId: string;

  @Column('text')
  text: string;

  @Column({ nullable: true })
  snippetId?: string;

  @ManyToOne(() => Channel, channel => channel.messages)
  channel: Channel;

  @CreateDateColumn()
  createdAt: Date;
}
