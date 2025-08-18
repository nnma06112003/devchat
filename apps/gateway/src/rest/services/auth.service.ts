import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  AUTH_COMMANDS,
  AuthResponseDto,
  LoginDto,
  RegisterDto,
  UserProfileDto,
} from '@shared/index';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class GWAuthService {
  constructor(@Inject('AUTH_SERVICE') private authClient: ClientProxy) {}

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    return firstValueFrom(
      this.authClient.send(AUTH_COMMANDS.REGISTER, registerDto),
    );
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    return firstValueFrom(this.authClient.send(AUTH_COMMANDS.LOGIN, loginDto));
  }

  async getProfile(userId: string): Promise<UserProfileDto> {
    return firstValueFrom(
      this.authClient.send(AUTH_COMMANDS.GET_PROFILE, { userId }),
    );
  }
}
