import { dataSource } from '../database.module';
import { ChannelSeeder } from './channel.seed';
import { UserSeeder } from './user.seeder';

async function bootstrap() {
  try {
    await dataSource.initialize();
    console.log('📦 Database connected');

    const seederUser = new UserSeeder(dataSource);
    await seederUser.run();

    const seederChannel = new ChannelSeeder(dataSource);
    await seederChannel.run();

    await dataSource.destroy();
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed', err);
    process.exit(1);
  }
}

bootstrap();
