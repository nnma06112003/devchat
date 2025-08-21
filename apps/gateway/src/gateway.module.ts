import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';

const SERVICES = ['auth', 'chat']; // mở rộng dễ dàng: search, file, notification...
const TOPICS = SERVICES.map(s => `svc.${s}.exec`);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      secret: 'dev-secret', // 2FA có thể bổ sung tại AuthService
      signOptions: { expiresIn: '1h' },
    }),
    ClientsModule.register([
      {
        name: 'KAFKA_GATEWAY',
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: 'gateway',
            brokers: ['localhost:29092'],
          },
          consumer: { groupId: 'gateway-consumer' },
        },
      },
    ]),
  ],
  controllers: [GatewayController],
  providers: [
    GatewayService,
    { provide: 'GATEWAY_TOPICS', useValue: TOPICS },
  ],
})
export class AppModule {}
