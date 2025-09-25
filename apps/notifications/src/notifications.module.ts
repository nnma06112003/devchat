import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NotificationController } from './notifications.controller';
import { NotificationService } from './notifications.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Notification, NotificationSchema } from '@myorg/schemas';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '@myorg/entities';
import { DatabaseModule } from '@myorg/database';
import { KafkaPublisher } from './kafka-publisher';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    ClientsModule.register([
      {
        name: 'NOTIF_SERVICE',
        transport: Transport.KAFKA,
        options: {
          client: {
            brokers: ['localhost:29092'],
          },
          consumer: {
            groupId: 'notification-consumer',
          },
        },
      },
    ]),
    DatabaseModule,
    TypeOrmModule.forFeature([Channel]),

    //Mongodb connection
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }),
    }),

    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, KafkaPublisher],
})
export class NotificationModule {}
