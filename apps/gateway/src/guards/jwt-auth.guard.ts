import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { GatewayService } from '../gateway.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly gw: GatewayService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    let token = req.headers.authorization?.replace('Bearer ', '');

    console.log('cookies', req.cookies);
    if (!token) {
      token = req.cookies['access_token'];
    }

    if (!token) throw new UnauthorizedException('No token provided');
    const data: any = await this.gw.exec('auth', 'verify_token', { token });

    if (!data?.data) return false;
    req.user = data?.data;
    return true;
  }
}
