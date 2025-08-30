import { dataSource } from '../database.module';
import { UserSeeder } from './user.seeder';

async function bootstrap() {
  try {
    await dataSource.initialize();
    console.log('📦 Database connected');

    const seeder = new UserSeeder(dataSource);
    await seeder.run();

    await dataSource.destroy();
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed', err);
    process.exit(1);
  }
}

bootstrap();
