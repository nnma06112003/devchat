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
  OneToOne,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Message } from './message.entity';
import { User } from './user.entity';
import { Repository } from './repository.entity';
import { Sheet } from './sheet.entity';

@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn()
  id: number | string;

  @Column()
  name: string;

  @Column({ nullable: true })
  key: string;

  @Column({ default: 'group' })
  type: 'personal' | 'group' | 'group-private';

  @Column({ default: 0 })
  member_count: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => Message, (message: any) => message.channel)
  messages: Message[];

   @Column({ type: 'jsonb', nullable: true })
    json_data?: any;

  @ManyToMany(() => User, (user) => user.channels, { cascade: true })
  @JoinTable({
    name: 'channel_members', // bảng trung gian
    joinColumn: { name: 'channel_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' },
  })
  users: User[];

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn()
  owner?: User;

  @ManyToMany(() => Repository, (repo) => repo.channels)
  repositories: Repository[];

  @OneToOne(() => Sheet, (sheet) => sheet.channel, { nullable: true })
  sheet?: Sheet;
}
