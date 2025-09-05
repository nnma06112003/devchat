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
        const totalMessages = 10000;
        const now = Date.now();
        let baseTime = now - totalMessages * 1000;
        for (let i = 1; i <= totalMessages; i++) {
        // Chọn ngẫu nhiên một user trong channel
        const sender = channel.users[Math.floor(Math.random() * channel.users.length)];
            // Tính send_at cho từng tin nhắn, mỗi tin nhắn cách nhau 1s
            let sendAt = baseTime + i * 1000;
            if (sendAt > now) sendAt = now;
            const message = messageRepo.create({
              text: `Tin nhắn ${i} trong kênh ${channel.name}`,
              channel,
              sender,
              send_at: new Date(sendAt),
            });
        messages.push(message);
      }
      await messageRepo.save(messages);
      console.log(`✅ Seeded ${totalMessages} messages for channel: ${channel.name}`);
    }
    console.log('✅ Message seeding done!');
  }
}
