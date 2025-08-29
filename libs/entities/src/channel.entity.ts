// libs/entities/src/channel.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Message } from './message.entity';

@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ default: 'group' })
  type: 'personal' | 'group';

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Message, (message:any) => message.channel)
  messages: Message[];
}
