import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AuthModule } from './auth.module';
import { Partitioners } from 'kafkajs'; 

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
      producer: {
        createPartitioner: Partitioners.JavaCompatiblePartitioner,     // chuẩn mới (khuyên dùng)
      },
    },
  });

  await app.listen();
  console.log(
    `Auth microservice is Running`,
  );
}
bootstrap();
