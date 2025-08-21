import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AuthModule } from './auth.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AuthModule,
    {
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'auth-svc',
        brokers: ['localhost:29092'],
      },
      consumer: { groupId: 'auth-svc-consumer' },
    },
  });

  await app.listen();
  console.log(
    `Auth microservice is listening on port ${3001}`,
  );
}
bootstrap();
