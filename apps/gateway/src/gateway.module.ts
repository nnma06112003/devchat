import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'AUTH_SERVICE',
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: parseInt(process.env.AUTH_PORT || '3001'),
        },
      },
    ]),
  ],
  controllers: [GatewayController],
  providers: [GatewayService, JwtAuthGuard],
})
export class GatewayModule {}
