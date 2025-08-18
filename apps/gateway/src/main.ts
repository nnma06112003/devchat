import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { GatewayModule } from './gateway.module';
import { RestModule } from './rest/rest.module';

async function bootstrap() {
  const app = await NestFactory.create(RestModule);

  // Enable CORS for development
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = parseInt(process.env.GATEWAY_PORT || '3000');
  await app.listen(port);
  console.log(`API Gateway is running on port ${port}`);
}
bootstrap();
