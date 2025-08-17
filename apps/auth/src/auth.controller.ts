import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  AuthResponseDto,
  UserProfileDto,
} from '@shared/dto/auth.dto';
import { AUTH_COMMANDS } from '@shared/interfaces/auth.interface';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(AUTH_COMMANDS.REGISTER)
  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(registerDto);
  }

  @MessagePattern(AUTH_COMMANDS.LOGIN)
  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(loginDto);
  }

  @MessagePattern(AUTH_COMMANDS.VERIFY_TOKEN)
  async verifyToken(data: { token: string }): Promise<any> {
    return this.authService.validateToken(data.token);
  }

  @MessagePattern(AUTH_COMMANDS.GET_PROFILE)
  async getProfile(data: { userId: string }): Promise<UserProfileDto> {
    return this.authService.getProfile(data.userId);
  }
}
