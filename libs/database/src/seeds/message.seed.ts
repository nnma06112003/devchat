import { DataSource } from 'typeorm';
import { Message, Channel, User } from '@myorg/entities';

export class MessageSeeder {
  constructor(private dataSource: DataSource) {}

  async run() {
    const messageRepo = this.dataSource.getRepository(Message);
    const channelRepo = this.dataSource.getRepository(Channel);
    const userRepo = this.dataSource.getRepository(User);

    const channels = await channelRepo.find({ relations: ['users'] });
    if (!channels.length) {
      console.log('⚠️ No channels found to seed messages.');
      return;
    }

    for (const channel of channels) {
      if (!channel.users || channel.users.length === 0) continue;
      const messages: Message[] = [];
      for (let i = 1; i <= 5; i++) {
        // Chọn ngẫu nhiên một user trong channel
        const sender = channel.users[Math.floor(Math.random() * channel.users.length)];
        const message = messageRepo.create({
          text: `Tin nhắn ${i} trong kênh ${channel.name}`,
          channel,
          sender,
        });
        messages.push(message);
      }
      await messageRepo.save(messages);
      console.log(`✅ Seeded 5 messages for channel: ${channel.name}`);
    }
    console.log('✅ Message seeding done!');
  }
}
