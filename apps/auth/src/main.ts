import { NestFactory } from '@nestjs/core';
import { AuthModule } from './auth.module';

async function bootstrap() {
  const app = await NestFactory.create(AuthModule);
  const port = 3000;
  await app.listen(port);
  console.log(`Service name: AuthService - Running on port: ${port}`);
  
}
bootstrap();
