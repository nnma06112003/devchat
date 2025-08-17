import { NestFactory } from '@nestjs/core';
import { AuthModule } from '../auth.module';
import { SeedService } from './seed.service';

async function bootstrap() {
  console.log('🌱 Starting database seeding...');

  const app = await NestFactory.createApplicationContext(AuthModule);
  const seedService = app.get(SeedService);

  try {
    await seedService.seed();
    console.log('✅ Seeding completed successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
