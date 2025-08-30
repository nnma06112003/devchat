// libs/entities/src/message.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from './channel.entity';
import { User } from './user.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id: number | string;

  @Column('text')
  text: string;

  @ManyToOne(() => Channel, (channel) => channel.messages, {
    onDelete: 'CASCADE',
  })
  channel: Channel;

  @ManyToOne(() => User, { nullable: false, onDelete: 'SET NULL' })
  sender: User;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
    updated_at: Date;
}
