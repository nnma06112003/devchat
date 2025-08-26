import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GatewayService } from '../gateway.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly gw: GatewayService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) throw new UnauthorizedException('No token provided');
    const data: any = await this.gw.exec('auth', 'verify_token', { token });

    if (!data.userData) return data;
    return true;
  }
}
