// libs/entities/src/message.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import { Channel } from './channel.entity';
import { User } from './user.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  senderId: string; // tham chiếu User

  @Column('text')
  text: string;

  @Column({ nullable: true })
  snippetId?: string;

  @ManyToOne(() => Channel, channel => channel.messages, {
    onDelete: 'CASCADE',
  })
  channel: Channel;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  sender: User;

  @CreateDateColumn()
  createdAt: Date;
}
