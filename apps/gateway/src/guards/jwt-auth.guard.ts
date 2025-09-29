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

    if (!token) {
      //Lấy token từ cookie nếu không có trong header
      token = req.cookies['access_token'];
      // console.log('Token from cookies:', token);
    }

    if (!token) throw new UnauthorizedException('No token provided');
    const data: any = await this.gw.exec('auth', 'verify_token', { token });

    if (!data?.data) return false;
    req.user = data?.data;
    return true;
  }
}
