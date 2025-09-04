import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplicationContext, UnauthorizedException } from '@nestjs/common';
import { ServerOptions, Socket } from 'socket.io';
import { GatewayService } from '../gateway.service';
import { ChatSocketService } from '../socket.service'; // 👈 thêm service quản lý presence
import Redis from 'ioredis';

export type AuthSocket = Socket & { user?: { id: string } };

export class AuthenticatedSocketIoAdapter extends IoAdapter {
  private gatewayService: GatewayService;
  private chatSocketService: ChatSocketService;

  constructor(app: INestApplicationContext) {
    super(app);
    this.gatewayService = app.get(GatewayService);
    this.chatSocketService = app.get(ChatSocketService); // 👈 inject
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);

    // middleware xác thực token
    server.use(async (socket: AuthSocket, next: any) => {
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

        socket.user = { id: data.data.sub || data.data.id }; // gán user từ token
        next();
      } catch (err) {
        next(err);
      }
    });

    // khi socket kết nối thành công
    server.on('connection', async (socket: AuthSocket) => {
      if (socket.user?.id) {
        await this.chatSocketService.markUserOnline(socket.user.id, socket.id);
      }

      socket.on('disconnect', async () => {
        if (socket.user?.id) {
          await this.chatSocketService.markUserOffline(socket.user.id);
        }
      });
    });

    return server;
  }
}
