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
import { User } from '@myorg/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository, Not } from 'typeorm';
import { MailerService } from '@nestjs-modules/mailer';
import * as crypto from 'crypto';
// import * as jose from 'jose'; // replaced with dynamic import in createAppJWT

@Injectable()
export class AuthService {
  // Tìm kiếm user theo username hoặc email

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private userRepository: UserRepository,
    private jwtService: JwtService,
    private readonly mailerService: MailerService,
  ) {}
  async searchUsers(
    user: any,
    params: { key: string; limit?: number },
  ): Promise<any[]> {
    const key = (params.key || '').trim();
    const limit = params.limit ?? 10;
    if (!key || !user || !user.id) return [];
    const users = await this.userRepo.find({
      where: [
        { username: Like(`%${key}%`), id: Not(user.id) },
        { email: Like(`%${key}%`), id: Not(user.id) },
      ],
      take: limit,
    });
    // Trả về thông tin cơ bản, loại bỏ trường nhạy cảm
    return users.map((u: User) => ({
      id: u.id,
      email: u.email,
      username: u.username,
    }));
  }
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

    // Nếu chưa có user bằng provider github, thử tìm theo email và link account nếu cần
    if (!user && githubProfile.email) {
      const existingByEmail = await this.userRepository.findByEmail(
        githubProfile.email,
      );

      if (existingByEmail) {
        const conllision = await this.userRepository.findByProvider(
          'github',
          githubProfile.id,
        );

        if (conllision && conllision.id !== existingByEmail.id) {
          throw new RpcException({
            msg: 'Tài khoản GitHub này đã được liên kết với một tài khoản khác',
            status: 409,
          });
        }
        // Link với account của devchat
        existingByEmail.provider = 'github';
        existingByEmail.provider_id = githubProfile.id;
        // existingByEmail.avatar = githubProfile.avatar || existingByEmail.avatar;
        existingByEmail.email_verified = true;
        await this.userRepository.save(existingByEmail);
        user = existingByEmail;
      }
    }

    // Nếu chưa có thì tạo mới user
    if (!user) {
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
      username: user.username,
      role: user.role,
    };

    const access_token = this.jwtService.sign(payload);

    const refresh_token = await this.generateAndSaverefresh_token(user);

    // 5. Trả về FE
    return {
      access_token,
      refresh_token,
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
      if (existingUser.provider === 'github') {
        throw new RpcException({
          msg: 'Tài khoản đã tồn tại dưới dạng đăng nhập bằng GitHub. Vui lòng đăng nhập bằng GitHub hoặc dùng chức năng "Thiết lập mật khẩu" để liên kết.',
          status: 409,
        });
      }
      throw new RpcException({ msg: 'Email đã tồn tại', status: 409 });
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user: any = await this.userRepository.create({
      ...registerDto,
      password: hashedPassword,
    });

    //generate verification token, save to user
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.verification_token = verificationToken;
    user.email_verified = false;
    await this.userRepository.save(user);

    //send verification email
    this.sendVerificationEmail(user.email);

    const payload: any = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    };
  }

  async confirmEmail(token: string): Promise<any> {
    const user: any = await this.userRepository.findByVerificationToken(token);
    if (!user) {
      throw new RpcException({
        msg: 'Token xác nhận không hợp lệ',
        status: 400,
      });
    }
    user.email_verified = true;
    user.verification_token = null;
    await this.userRepository.save(user);
    return;
  }

  async sendVerificationEmail(email: string): Promise<any> {
    const user: any = await this.userRepository.findByEmail(email);
    if (!user)
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    if (user.email_verified)
      return { status: 200, msg: 'Email đã được xác thực' };

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.verification_token = verificationToken;
    await this.userRepository.save(user);

    const frontendConfirmUrl = `${process.env.FE_URL}/auth/confirm-email?token=${verificationToken}&email=${user.email}`;
    await this.mailerService.sendMail({
      to: user.email,
      subject: 'Xác nhận email của bạn',
      template: 'confirmation', // dùng tên template (không để './')
      context: { name: user.username || 'User', url: frontendConfirmUrl },
      // text: `Xin chào ${user.username || 'User'}, xác nhận email: ${frontendConfirmUrl}`,
      // html: `<p>Xin chào ${user.username || 'User'},</p><p><a href="${frontendConfirmUrl}">Xác nhận email</a></p>`,
    });

    return { status: 200, msg: 'Đã gửi lại email xác thực' };
  }

  async login(loginDto: LoginDto): Promise<any> {
    const user: any = await this.userRepository.findByEmail(loginDto.email);

    if (!user.email_verified) {
      throw new RpcException({
        msg: 'Vui lòng xác thực email trước khi đăng nhập',
        status: 401,
      });
    }

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
      username: user.username,
      role: user.role,
      github_verified: user.github_verified
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
        username: user?.username,
        role: user?.role,
        github_verified: user.github_verified
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
      username: user.username,
      role: user.role,
      github_verified: user.github_verified,
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
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      github_verified: user.github_verified
    };

    const access_token = this.jwtService.sign(payload);
    const new_refresh_token = await this.generateAndSaverefresh_token(user);

    // 4. Trả về token mới
    return {
      access_token: access_token ?? null,
      refresh_token: new_refresh_token ?? null,
    };
  }

  async updateProfile(userId: string, data: { username?: string; email?: string , github_verified?: boolean , github_installation_id?: string }): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }

    // Chỉ cập nhật các trường hợp lệ
    if (data.username !== undefined) user.username = data.username;
    if (data.email !== undefined) user.email = data.email;
    if (data.github_verified !== undefined) user.github_verified = data.github_verified;
    if (data.github_installation_id !== undefined) user.github_installation_id = data.github_installation_id;

    await this.userRepository.save(user);

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      updated_at: user.updated_at,
      github_verified: user.github_verified
    };
  }

  async getTokenUserData(userId: any): Promise<any> {

    const user: any = await this.userRepository.findById(userId);

    if (user.refresh_token) {
      return null;
    }
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      github_verified: user.github_verified
    };
    const access_token = this.jwtService.sign(payload);
    const new_refresh_token = await this.generateAndSaverefresh_token(user);

    // 4. Trả về token mới
    return {
      access_token: access_token ?? null,
      refresh_token: new_refresh_token ?? null,
    };
  }

async handleGitHubCallback(code: string, state: string) {
  try {
    // 1) Exchange code -> token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_APP_CLIENT_ID,
        client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
        code,
      }),
    });

    // Nếu header trả về là application/json thì dùng .json(), nếu không thì dùng .text()
    let tokenData: any;
    const contentType = tokenRes.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      tokenData = await tokenRes.json();
    } else {
      const rawText = await tokenRes.text();
      console.log('GitHub token response:', rawText);
      tokenData = Object.fromEntries(new URLSearchParams(rawText));
    }

    const github_user_token = tokenData.access_token;
    console.log("github_user_token", github_user_token);

    if (!github_user_token) {
      throw new UnauthorizedException('Không lấy được access_token từ GitHub');
    }

    // 2) Get user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${github_user_token}` },
    });
    const gh = await userRes.json();
    console.log("gh", gh);

    // 3) Upsert user (merge & save 1 lần)
    const existing = await this.userRepository.findByEmail(gh.email);
    const userData: any = {
      email: gh.email,
      username: gh.login,
      github_avatar: gh.avatar_url,
      provider: 'github',
      provider_id: String(gh.id),
      github_user_token,
      github_verified: true,
    };
    if (existing?.id !== undefined) {
      userData.id = existing.id;
    }
    const user = await this.userRepository.save(userData);

    // 4) Check installation (404 => chưa cài app)
    let installationId: number | undefined;
    let needInstall = false;
    try {
      const appJwt = await this.createAppJWT();
      const instRes = await fetch(`https://api.github.com/users/${gh.login}/installation`, {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (instRes.status === 404) {
        needInstall = true;
      } else {
        const inst = await instRes.json();
        installationId = inst.id;
        console.log("installationId", installationId);
      }
    } catch (err: any) {
      // Không throw lỗi, chỉ đánh dấu needInstall nếu 404
      needInstall = true;
    }

    if (installationId) {
      user.github_installation_id = String(installationId);
      await this.userRepository.save(user); // chỉ gọi lần 2 khi có installation
    }

    return { user, needInstall, installationId };
  } catch (e: any) {
    console.log('GitHub OAuth failed', e);
    throw new UnauthorizedException(e.message || 'GitHub OAuth failed');
  }
}

private async createAppJWT(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyPem) {
    throw new Error('Missing required GitHub App environment variables');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 30,
    exp: now + 9 * 60,
    iss: appId,
  };
  const jose = await import('jose');
  const pk = await jose.importPKCS8(privateKeyPem.replace(/\\n/g, '\n'), 'RS256');
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256' })
    .sign(pk);
}
}
