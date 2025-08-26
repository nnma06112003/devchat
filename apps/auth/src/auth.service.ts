  // Tạo refreshToken và lưu vào user
  

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import axios from 'axios';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UserRepository } from './repositories/user.repository';
import {
  RegisterDto,
  LoginDto,
  AuthResponseDto,
  UserProfileDto,
} from 'apps/auth/src/dto/auth.dto';
import { JwtPayload } from 'apps/auth/src/interfaces/auth.interface';

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
    // const { data: emails } = await axios.get('https://api.github.com/user/emails', {
    //   headers: { Authorization: `Bearer ${accessToken}` },
    // });
    // const primaryEmail = emails.find((e) => e.primary)?.email;

    // Chuẩn hóa profile
    const githubProfile = {
      id: profile.id,
      username: profile.login,
      avatar: profile.avatar_url,
      email: profile.email, // có thể null nếu user ẩn email
    };

    // 3. Kiểm tra user trong DB
    let user = await this.userRepository.findByProvider('github', githubProfile.id);

    if (!user) {
      // Nếu chưa có thì tạo mới user
      user = await this.userRepository.create({
        email: githubProfile.email,
        username: githubProfile.username,
        avatar: githubProfile.avatar,
        provider: 'github',
        providerId: githubProfile.id,
      } as any);
    }

    // 4. Sinh JWT
    const payload: JwtPayload = {
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
        providerId: user.providerId,
        role: user.role,
      },
    };
  }
  async register(registerDto: RegisterDto): Promise<any> {
    const existingUser = await this.userRepository.findByEmail(
      registerDto.email,
    );
    if (existingUser) {
      throw new ConflictException('User already exists with this email');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await this.userRepository.create({
      ...registerDto,
      password: hashedPassword,
    });

    const payload: JwtPayload = {
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
    const user:any = await this.userRepository.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const access_token = this.jwtService.sign(payload);
    const refresh_token = await this.generateAndSaveRefreshToken(user);

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        avatar: user.avatar,
        provider: user.provider,
        providerId: user.providerId,
        role: user.role,
      },
    };
  }

  async validateToken(token: string): Promise<any> {
    try {
      const payload = this.jwtService.verify(token);
      const user = await this.userRepository.findById(payload.sub);

      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      const userData = 
      {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      };
      return userData;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        // Trả về lỗi 409 nếu token hết hạn
        throw new ConflictException('Token expired');
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  async getProfile(userId: string): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
private async generateAndSaveRefreshToken(user: any): Promise<string> {
    const refreshToken = this.jwtService.sign({ sub: user.id }, { expiresIn: '7d' });
    user.refreshToken = refreshToken;
    await this.userRepository.save(user);
    return refreshToken;
  }

  // Refresh token
  async refreshToken(dto: { refreshToken: string }): Promise<any> {
    // Tìm user theo refreshToken
    const user = await this.userRepository.findByRefreshToken(dto.refreshToken);
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    // Tạo access_token mới
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const access_token = this.jwtService.sign(payload);
    return {
      access_token,
      refresh_token: user.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        avatar: user.avatar,
        provider: user.provider,
        providerId: user.providerId,
        role: user.role,
      },
    };
  }


}
