import { DataSource } from 'typeorm';
import { Channel ,User} from '@myorg/entities';

export class ChannelSeeder {
  constructor(private dataSource: DataSource) {}

  async run() {
    const channelRepo = this.dataSource.getRepository(Channel);
    const userRepo = this.dataSource.getRepository(User);

    const users = await userRepo.find();
    if (users.length < 2) {
      console.log('⚠️ Not enough users to seed channels.');
      return;
    }

    const channels: Channel[] = [];

    // --- Group channels ---
    for (let i = 1; i <= 5; i++) {
      // random 3–6 user
      const memberCount = Math.floor(Math.random() * 4) + 3;
      const shuffled = users.sort(() => 0.5 - Math.random());
      const members = shuffled.slice(0, memberCount);

      const channel = channelRepo.create({
        name: `Group Chat ${i}`,
        type: 'group',
        users: members,
        member_count: members.length,
        owner: members[0], // user đầu tiên là owner
      });

      channels.push(channel);
    }

    // --- Personal channels (1-1) ---
    for (let i = 1; i <= 5; i++) {
      const shuffled = users.sort(() => 0.5 - Math.random());
      const members = shuffled.slice(0, 2);

      const channel = channelRepo.create({
        name: `Personal Chat ${i}`,
        type: 'personal',
        users: members,
        member_count: members.length,
      });

      channels.push(channel);
    }

    await channelRepo.save(channels);

    console.log(`✅ Channel seeding done! (${channels.length} channels)`);
  }
}
