import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { User } from './user.entity';
import { Channel } from './channel.entity';

@Entity('repositories')
export class Repository {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 512 })
  repo_id: string;

  // Repo thuộc về 1 user (owner)
  @ManyToOne(() => User, { nullable: false })
  user: User;

  // Repo có thể thuộc nhiều channel, channel chỉ có 1 repo (1-1 hoặc 1-n)
  @ManyToMany(() => Channel, (channel) => channel.repositories)
  @JoinTable({
    name: 'repository_channels',
    joinColumn: { name: 'repository_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'channel_id', referencedColumnName: 'id' },
  })
  channels: Channel[];
}