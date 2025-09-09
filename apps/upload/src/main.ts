import { NestFactory } from '@nestjs/core';
import { UploadModule } from './upload.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { RpcResponseInterceptor } from '@myorg/common';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(UploadModule, {
    transport: Transport.KAFKA,
    options: {
      client: {
        brokers: ['localhost:29092'],
        clientId: 'upload',
      },
      consumer: {
        groupId: 'upload-consumer',
        
      },
    },
  });

  app.useGlobalInterceptors(new RpcResponseInterceptor());
  await app.listen();
  console.log(`🚀 Upload microservice is running`);
}
bootstrap();