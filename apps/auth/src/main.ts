import { NestFactory } from '@nestjs/core';
import { AuthModule } from './auth.module';

async function bootstrap() {
  const app = await NestFactory.create(AuthModule);
  const port = process.env.AUTH_PORT || 3001;
  await app.listen(port);
  console.log(`Auth service is running on port ${port}`);
}
bootstrap();
