// libs/entities/src/user.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToMany,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from './channel.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number | string;

  @Column({ nullable: true })
  username?: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  password?: string;

  @Column({ nullable: true })
  provider?: string;

  @Column({ nullable: true })
  provider_id?: string;

  @Column({ default: 'user' })
  role: string;

  @Column({ nullable: true })
  refresh_token?: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToMany(() => Channel, (channel) => channel.users)
  channels: Channel[];
}
