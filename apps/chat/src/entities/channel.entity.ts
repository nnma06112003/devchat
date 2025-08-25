import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	OneToMany,
} from 'typeorm';
import { Message } from './message.entity';

@Entity('channels')
export class Channel {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column()
	name: string;

	@Column({ default: 'public' })
	visibility: string; // public/private

	@Column('simple-array', { nullable: true })
	members: string[];

	@OneToMany(() => Message, message => message.channel)
	messages: Message[];

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;
}
