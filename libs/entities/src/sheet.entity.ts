import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Channel } from './channel.entity';

@Entity('sheets')
export class Sheet {
  @PrimaryGeneratedColumn()
  id: number | string;

  @OneToOne(() => Channel, (channel) => channel.sheet)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ type: 'varchar', nullable: false })
  sheetKey: string;

  @Column({ type: 'varchar', nullable: false })
  sheetUrl: string;
}
