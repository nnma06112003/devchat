// Tạo refresh_token và lưu vào user

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UserRepository } from './repositories/user.repository';
import { RegisterDto, LoginDto } from 'apps/auth/src/dto/auth.dto';
import { JwtPayload } from 'apps/auth/src/interfaces/auth.interface';
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
      github_verified: user.github_verified,
      github_installation_id: user.github_installation_id || null,
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
        github_verified: user.github_verified,
        github_installation_id: user.github_installation_id || null,
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
      github_installation_id: user.github_installation_id || null,
      avatar: user.avatar || user.github_avatar,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
  private async generateAndSaverefresh_token(user: any): Promise<string> {
    const refresh_token = this.jwtService.sign(
      { sub: user.id },
      {
        expiresIn: '7d',
        secret:
          process.env.REFRESH_SECRET_KEY ||
          'nguyenthaibinhduongdevchatapprefresh',
      },
    );
    user.refresh_token = refresh_token;
    await this.userRepository.save(user);
    return refresh_token;
  }

  // Refresh token
  async refreshToken(refresh_token: string): Promise<any> {
    const payload: any = this.jwtService.verify(refresh_token, {
      secret:
        process.env.REFRESH_SECRET_KEY ||
        'nguyenthaibinhduongdevchatapprefresh',
    });
    const user: any = await this.userRepository.findById(payload.sub);
    console.log('user id:', payload.sub);
    console.log('user:', user);

    if (!user || user.refresh_token !== refresh_token) {
      throw new RpcException({
        msg: 'Refresh token không hợp lệ',
        status: 401,
      });
    }

    // 2. Tạo access_token mới
    const payloadData: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      github_verified: user.github_verified,
      github_installation_id: user.github_installation_id || null,
    };

    console.log('payload:', payloadData);

    const access_token = this.jwtService.sign(payloadData);
    const new_refresh_token = await this.generateAndSaverefresh_token(user);

    // 4. Trả về token mới
    return {
      access_token: access_token ?? null,
      refresh_token: new_refresh_token ?? null,
    };
  }

  async updateProfile(
    userId: string,
    data: {
      username?: string;
      email?: string;
      github_verified?: boolean;
      github_installation_id?: string;
    },
  ): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }

    // Chỉ cập nhật các trường hợp lệ
    if (data.username !== undefined) user.username = data.username;
    if (data.email !== undefined) user.email = data.email;
    if (data.github_verified !== undefined)
      user.github_verified = data.github_verified;
    if (data.github_installation_id !== undefined)
      user.github_installation_id = data.github_installation_id;

    await this.userRepository.save(user);

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      updated_at: user.updated_at,
      github_verified: user.github_verified,
    };
  }

  async getTokenUserData(userId: any): Promise<any> {
    const user: any = await this.userRepository.findById(userId);

    // if (user.refresh_token) {
    //   return null;
    // }
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      github_verified: user.github_verified,
      github_installation_id: user.github_installation_id || null,
    };
    const access_token = this.jwtService.sign(payload);
    const new_refresh_token = await this.generateAndSaverefresh_token(user);

    // 4. Trả về token mới
    return {
      access_token: access_token ?? null,
      refresh_token: new_refresh_token ?? null,
    };
  }

  //Verify Github Webhook Signature
  verifyWebhookSignature(signature: string, rawBody: Buffer | string): void {
    if (!signature) throw new UnauthorizedException('Missing signature');

    // Ensure signature starts with expected prefix
    const expectedPrefix = 'sha256='; // GitHub uses sha256
    if (!signature.startsWith(expectedPrefix)) {
      throw new UnauthorizedException('Invalid signature format');
    }

    // Use Buffer for HMAC input
    const payloadBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(rawBody || '', 'utf8');

    const secret = process.env.GITHUB_WEBHOOK_SECRET || 'my-webhook-secret';
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadBuffer);
    const digest = `${expectedPrefix}${hmac.digest('hex')}`;

    const sigBuffer = Buffer.from(signature, 'utf8');
    const digestBuffer = Buffer.from(digest, 'utf8');

    // timingSafeEqual requires same length buffers
    if (sigBuffer.length !== digestBuffer.length) {
      throw new UnauthorizedException('Invalid signature');
    }

    const valid = crypto.timingSafeEqual(digestBuffer, sigBuffer);

    console.log('Computed digest:', digest);
    console.log('Received signature:', signature);
    console.log('Signature valid:', valid);

    if (!valid) {
      throw new UnauthorizedException('Invalid signature');
    }
  }

  //Upadate password
  async updatePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<any> {
    const user: any = await this.userRepository.findById(userId);
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      throw new RpcException({
        msg: 'Mật khẩu cũ không chính xác',
        status: 400,
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await this.userRepository.save(user);
    return { status: 200, msg: 'Cập nhật mật khẩu thành công' };
  }
}
