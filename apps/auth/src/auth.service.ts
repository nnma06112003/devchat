// Tạo refresh_token và lưu vào user

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import axios from 'axios';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UserRepository } from './repositories/user.repository';
import { RegisterDto, LoginDto } from 'apps/auth/src/dto/auth.dto';
import { JwtPayload } from 'apps/auth/src/interfaces/auth.interface';
import { RpcCustomException } from '@myorg/common';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private jwtService: JwtService,
  ) {}
  // Đăng nhập bằng Github OAuth
  async loginGithubOAuth(code: string): Promise<any> {
    // 1. Đổi code lấy access_token từ GitHub
    const tokenRes = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: 'application/json' } },
    );

    const accessToken = tokenRes.data.access_token;

    // 2. Lấy profile GitHub
    const { data: profile } = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Có thể gọi thêm API này để lấy email chính xác hơn:
    const { data: emails } = await axios.get(
      'https://api.github.com/user/emails',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    interface GithubEmail {
      email: string;
      primary: boolean;
      verified: boolean;
      visibility: string | null;
    }

    const primaryEmail: string | undefined = (emails as GithubEmail[]).find(
      (e) => e.primary,
    )?.email;

    // Chuẩn hóa profile
    const githubProfile = {
      id: profile.id,
      username: profile.login,
      avatar: profile.avatar_url,
      email: profile.email ?? primaryEmail, // có thể null nếu user ẩn email
    };

    // 3. Kiểm tra user trong DB
    let user: any = await this.userRepository.findByProvider(
      'github',
      githubProfile.id,
    );

    if (!user) {
      // Nếu chưa có thì tạo mới user
      user = await this.userRepository.create({
        email: githubProfile.email,
        username: githubProfile.username,
        avatar: githubProfile.avatar,
        provider: 'github',
        provider_id: githubProfile.id,
      } as any);
    }

    // 4. Sinh JWT
    const payload: any = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const access_token = this.jwtService.sign(payload);

    // 5. Trả về FE
    return {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        provider: user.provider,
        provider_id: user.provider_id,
        role: user.role,
      },
    };
  }
  async register(registerDto: RegisterDto): Promise<any> {
    const existingUser = await this.userRepository.findByEmail(
      registerDto.email,
    );
    if (existingUser) {
      throw new RpcException({ msg: 'Email đã tồn tại', status: 409 });
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user: any = await this.userRepository.create({
      ...registerDto,
      password: hashedPassword,
    });

    const payload: any = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  async login(loginDto: LoginDto): Promise<any> {
    const user: any = await this.userRepository.findByEmail(loginDto.email);
    if (!user) {
      throw new RpcException({
        msg: 'Tài khoản hoặc mật khẩu không đúng',
        status: 401,
      });
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!isPasswordValid) {
      throw new RpcException({
        msg: 'Tài khoản hoặc mật khẩu không đúng',
        status: 401,
      });
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const access_token = this.jwtService.sign(payload);
    const refresh_token = await this.generateAndSaverefresh_token(user);

    return {
      access_token,
      refresh_token,
    };
  }

  async validateToken(token: string): Promise<any> {
    try {
      const payload = this.jwtService.verify(token);
      const user: any = await this.userRepository.findById(payload.sub);

      if (!user) {
        throw new RpcException({
          msg: 'Không tìm thấy người dùng',
          status: 401,
        });
      }
      const userData = {
        id: user?.id,
        email: user?.email,
        firstName: user?.firstName,
        lastName: user?.lastName,
        role: user?.role,
      };
      return userData;
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        throw new RpcException({ msg: 'Token đã hết hạn', status: 409 });
      }
      throw new RpcException({ msg: 'Token không hợp lệ', status: 401 });
    }
  }

  async getProfile(userId: string): Promise<any> {
    const user: any = await this.userRepository.findById(userId);
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 401 });
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
  private async generateAndSaverefresh_token(user: any): Promise<string> {
    const refresh_token = this.jwtService.sign(
      { sub: user.id },
      { expiresIn: '7d' },
    );
    user.refresh_token = refresh_token;
    await this.userRepository.save(user);
    return refresh_token;
  }

  // Refresh token
  async refreshToken(refresh_token: string): Promise<any> {
    const user: any =
      await this.userRepository.findByrefresh_token(refresh_token);

    if (!user) {
      throw new RpcException({
        msg: 'Refresh token không hợp lệ',
        status: 401,
      });
    }

    // 2. Tạo access_token mới
    const payload: any = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const access_token = this.jwtService.sign(payload);
    const new_refresh_token = await this.generateAndSaverefresh_token(user);

    // 4. Trả về token mới
    return {
      access_token: access_token ?? null,
      refresh_token: new_refresh_token ?? null,
    };
  }
}
