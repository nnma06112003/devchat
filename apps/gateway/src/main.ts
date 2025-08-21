import { NestFactory } from '@nestjs/core';
import { AppModule } from './gateway.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefix chung cho API (tùy chọn)
  app.setGlobalPrefix('api');

  // Bật validation tự động với class-validator (nếu dùng DTO)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,        // loại bỏ field thừa
      forbidNonWhitelisted: true,
      transform: true,        // tự cast kiểu (string -> number,…)
    }),
  );

  // (tùy chọn) bật CORS nếu FE khác domain
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const port = process.env.GATEWAY_PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Gateway running at http://localhost:${port}`);
}
bootstrap();
