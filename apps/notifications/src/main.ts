import { NestFactory } from '@nestjs/core';
import { NotificationModule } from './notifications.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { RpcResponseInterceptor } from '@myorg/common';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    NotificationModule,
    {
      transport: Transport.KAFKA,
      options: {
        client: {
          brokers: ['localhost:29092'],
          clientId: 'notification',
        },
        consumer: {
          groupId: 'notification-consumer',
        },
      },
    },
  );

  app.useGlobalInterceptors(new RpcResponseInterceptor());
  await app.listen();
  console.log(`🚀 Notification microservice is running`);
}
bootstrap();
