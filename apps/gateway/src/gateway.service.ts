import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  RegisterDto,
  LoginDto,
  AuthResponseDto,
  UserProfileDto,
} from '@shared/dto/auth.dto';
import { AUTH_COMMANDS } from '@shared/interfaces/auth.interface';

@Injectable()
export class GatewayService {
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
