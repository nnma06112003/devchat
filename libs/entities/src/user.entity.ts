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
  id: number | string; // KHÔNG dùng number | string

  @Column({ type: 'varchar', length: 255, nullable: true })
  username?: string;

  @Column({ type: 'varchar', length: 320, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  provider?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  provider_id?: string;

  @Column({ type: 'varchar', length: 50, default: 'user' })
  role: string;

  @Column({ type: 'text', nullable: true })
  refresh_token?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToMany(() => Channel, (channel) => channel.users)
  channels: Channel[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  verification_token: string;

  @Column({ type: 'boolean', default: false })
  email_verified: boolean;

  @Column({ type: 'boolean', default: false })
  github_verified: boolean;

  // ====== GitHub App fields ======

  // Token user-level (ghu_...)
  @Column({ type: 'text', nullable: true })
  github_user_token?: string;

  // Expire time của user token (nếu có)
  @Column({ type: 'timestamptz', nullable: true })
  github_user_token_expire?: Date;

  // Installation ID (dạng text cho an toàn)
  @Column({ type: 'text', nullable: true })
  github_installation_id?: string;

  // GitHub user id (số, lưu dạng text để an toàn)
  @Column({ type: 'text', nullable: true })
  github_user_id?: string;

  // GitHub login (username)
  @Column({ type: 'varchar', length: 255, nullable: true })
  github_login?: string;

  // GitHub email
  @Column({ type: 'varchar', length: 320, nullable: true })
  github_email?: string;

  // GitHub avatar
  @Column({ type: 'text', nullable: true })
  github_avatar?: string;

  // (Optional) Lưu các repo đã cấp quyền (jsonb)
  @Column({ type: 'jsonb', nullable: true })
  github_repositories?: any[];
}
