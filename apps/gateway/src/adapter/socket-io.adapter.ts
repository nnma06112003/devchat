import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplicationContext, UnauthorizedException } from '@nestjs/common';
import { ServerOptions, Socket } from 'socket.io';
import { GatewayService } from '../gateway.service';

export class AuthenticatedSocketIoAdapter extends IoAdapter {
  private gatewayService: GatewayService;

  constructor(app: INestApplicationContext) {
    super(app);
    this.gatewayService = app.get(GatewayService);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);

    server.use(async (socket: Socket, next:any) => {
      try {
        const token =
          socket.handshake?.auth?.token ||
          socket.handshake?.headers['authorization']?.replace('Bearer ', '');

        if (!token) {
          return next(new UnauthorizedException('No token provided'));
        }

        const data: any = await this.gatewayService.exec('auth', 'verify_token', { token });

        if (!data?.data) {
          return next(new UnauthorizedException('Invalid token'));
        }

        (socket as any).user = data.data; // ✅ gán user đã verify
        next();
      } catch (err) {
        next(err);
      }
    });

    return server;
  }
}
