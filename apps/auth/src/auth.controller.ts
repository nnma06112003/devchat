import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern('svc.auth.exec')
  async handle(@Payload() message: { cmd: string; data: any }) {
    const { cmd, data } = message || {};
    switch (cmd) {
      case 'login':
        return this.authService.login(data);
      case 'register':
        return this.authService.register(data);
      case 'verify_token':
        return this.authService.validateToken(data.token);
      case 'refresh':
        return this.authService.refreshToken(data.refresh_token);
      case 'get_profile':
        return this.authService.getProfile(data.userId);
      case 'update_profile':
        return this.authService.updateProfile(data.user.id, data);
      case 'searchUsers':
        return this.authService.searchUsers(data.user, data.data);
      case 'confirm_email':
        return this.authService.confirmEmail(data.token);
      case 'get_token_info':
        return this.authService.getTokenUserData(data.userId);
      default:
        return { ok: false, error: `Unknown cmd: ${cmd}` };
    }
  }
}
