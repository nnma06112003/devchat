// libs/entities/src/channel.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Message } from './message.entity';
import { User } from './user.entity';

@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn()
  id: number | string;

  @Column()
  name: string;

  @Column({ default: 'group' })
  type: 'personal' | 'group';

  @Column({ default: 0 })
  member_count: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => Message, (message: any) => message.channel)
  messages: Message[];

  @ManyToMany(() => User, (user) => user.channels, { cascade: true })
  @JoinTable({
    name: 'channel_members', // bảng trung gian
    joinColumn: { name: 'channel_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' },
  })
  users: User[];
}
