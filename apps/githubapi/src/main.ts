import { NestFactory } from '@nestjs/core';
import { GitModule } from './git.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { RpcResponseInterceptor } from '@myorg/common';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    GitModule,
    {
      transport: Transport.KAFKA,
      options: {
        client: {
          brokers: ['localhost:29092'],
          clientId: 'git',
        },
        consumer: {
          groupId: 'git-consumer',
          sessionTimeout: 60000,
          heartbeatInterval: 3000,
          retry: { retries: 5 },
        },
      },
    },
  );

  app.useGlobalInterceptors(new RpcResponseInterceptor());
  await app.listen();
  console.log(`🚀 Git microservice is running`);
}
bootstrap();
