import { NestFactory } from '@nestjs/core';
import { AppModule } from './gateway.module';
import { ValidationPipe } from '@nestjs/common';
import { GatewayRpcExceptionFilter } from '@myorg/common';
import { AuthenticatedSocketIoAdapter } from './adapter/socket-io.adapter'; // thêm dòng này

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new GatewayRpcExceptionFilter());
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // ⚡ cấu hình Socket.IO adapter có xác thực JWT
  app.useWebSocketAdapter(new AuthenticatedSocketIoAdapter(app));

  const port = 3088;
  await app.listen(port);
  console.log(`🚀 Gateway running at http://localhost:${port}`);
}
bootstrap();
