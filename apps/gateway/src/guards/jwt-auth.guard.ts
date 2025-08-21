import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers['authorization'] as string | undefined;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');
    try {
      const payload = this.jwt.verify(auth.slice(7));
      req.user = payload; // { sub, roles, workspaceId, ... }
      // Optionally check role here or via custom decorator
      return true;
    } catch {
      throw new ForbiddenException('Invalid token');
    }
  }
}
