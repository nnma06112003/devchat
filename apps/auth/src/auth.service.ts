// Tạo refresh_token và lưu vào user

import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
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
import Redis from 'ioredis';
import axios from 'axios';

@Injectable()
export class AuthService {
  private readonly algorithm = 'aes-256-cbc';
  private encryptionKey: Buffer;
  private readonly recaptchaSecret = process.env.RECAPTCHA_SECRET;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private userRepository: UserRepository,
    private jwtService: JwtService,
    private readonly mailerService: MailerService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    // Khởi tạo encryption key (giống gateway)
    const key = process.env.ID_ENCRYPTION_KEY || 'default-secret-key-32-chars-min';
    this.encryptionKey = crypto.scryptSync(key, 'salt', 32);
  }

  /**
   * Xác thực reCAPTCHA token
   */
  private async verifyCaptcha(token: string): Promise<boolean> {
    if (!token || token.trim() === '') {
      console.log('❌ [CAPTCHA] Token rỗng');
      throw new RpcException({
        msg: 'Vui lòng xác thực CAPTCHA',
        status: 400,
      });
    }

    if (!this.recaptchaSecret) {
      console.error('❌ [CAPTCHA] RECAPTCHA_SECRET chưa được cấu hình');
      throw new RpcException({
        msg: 'Cấu hình CAPTCHA không hợp lệ',
        status: 500,
      });
    }

    try {
      console.log(`🔍 [CAPTCHA] Đang xác thực token: ${token.substring(0, 20)}...`);

      const response = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        new URLSearchParams({
          secret: this.recaptchaSecret,
          response: token,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        }
      );

      const { success, score, action, 'error-codes': errorCodes } = response.data;

      console.log(`📊 [CAPTCHA] Kết quả:`, {
        success,
        score,
        action,
        errorCodes,
      });

      if (!success) {
        console.warn(`❌ [CAPTCHA] Xác thực thất bại:`, errorCodes);
        throw new RpcException({
          msg: 'CAPTCHA không hợp lệ hoặc đã hết hạn',
          status: 400,
        });
      }

      // Kiểm tra score (reCAPTCHA v3)
      if (score !== undefined && score < 0.5) {
        console.warn(`⚠️ [CAPTCHA] Score thấp: ${score}`);
        throw new RpcException({
          msg: 'Xác thực CAPTCHA không đạt yêu cầu bảo mật',
          status: 403,
        });
      }

      console.log(`✅ [CAPTCHA] Xác thực thành công - Score: ${score || 'N/A'}`);
      return true;

    } catch (error: any) {
      if (error instanceof RpcException) {
        throw error;
      }

      console.error(`❌ [CAPTCHA] Lỗi:`, {
        message: error?.message,
        code: error?.code,
      });

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new RpcException({
          msg: 'Không thể kết nối đến dịch vụ CAPTCHA',
          status: 504,
        });
      }

      throw new RpcException({
        msg: 'Lỗi xác thực CAPTCHA',
        status: 500,
      });
    }
  }

  /**
   * Mã hóa ID (giống gateway service)
   */
  private encryptId(id: string | number): string {
    try {
      const text = String(id);
      const iv = crypto
        .createHash('md5')
        .update(text + process.env.ID_ENCRYPTION_KEY)
        .digest();
      
      const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const combined = iv.toString('hex') + ':' + encrypted;
      return 'ENC:' + Buffer.from(combined).toString('base64');
    } catch (err) {
      console.error('❌ Encrypt ID error:', err);
      return String(id);
    }
  }

  /**
   * Giải mã ID (giống gateway service)
   */
  private decryptId(encryptedId: string): string {
    try {
      if (!encryptedId || !encryptedId.startsWith('ENC:')) {
        return encryptedId;
      }

      const base64Data = encryptedId.substring(4);
      const combined = Buffer.from(base64Data, 'base64').toString('utf8');
      const parts = combined.split(':');
      
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (err) {
      console.error('❌ Decrypt ID error:', err);
      throw new RpcException({ status: 400, msg: 'ID không hợp lệ hoặc đã bị thay đổi' });
    }
  }
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

    // Mã hóa sub trước khi tạo JWT
    const payload: any = {
      sub: this.encryptId(user.id),
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
      template: 'confirmation',
      context: { name: user.username || 'User', url: frontendConfirmUrl },
    });

    return { status: 200, msg: 'Đã gửi lại email xác thực' };
  }

  async login(loginDto: LoginDto): Promise<any> {
    try {
      // ✅ 1. XÁC THỰC CAPTCHA TRƯỚC TIÊN
      console.log('🔐 [LOGIN] Bắt đầu xác thực CAPTCHA...');
      if (loginDto.captchaToken) {
        await this.verifyCaptcha(loginDto.captchaToken);
        console.log('✅ [LOGIN] CAPTCHA hợp lệ');
      } else {
         throw new RpcException({
          msg: 'Vui lòng xác thực CAPTCHA',
          status: 401,
        });
      }

      // 2. Tìm user
      console.log(`🔍 [LOGIN] Tìm user với email: ${loginDto.email}`);
      const user: any = await this.userRepository.findByEmail(loginDto.email);
      if (!user) {
        throw new RpcException({
          msg: 'Bạn chưa đăng ký tài khoản. Vui lòng đăng ký trước khi đăng nhập',
          status: 401,
        });
      }

      // 3. Kiểm tra email verified
      if (!user.email_verified) {
        throw new RpcException({
          msg: 'Vui lòng xác thực email trước khi đăng nhập',
          status: 401,
        });
      }

      // 4. Kiểm tra account active
      if (!user.isActive) {
        throw new RpcException({
          msg: 'Tài khoản đã bị vô hiệu hóa',
          status: 403,
        });
      }

      // 5. Kiểm tra password
      console.log('🔐 [LOGIN] Đang xác thực mật khẩu...');
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

      // 6. Tạo JWT tokens
      console.log('🎫 [LOGIN] Tạo access token và refresh token...');
      const payload: JwtPayload = {
        sub: this.encryptId(user.id),
        email: user.email,
        username: user.username,
        role: user.role,
        github_verified: user.github_verified,
        github_installation_id: user.github_installation_id || null,
      };
      const access_token = this.jwtService.sign(payload);
      const refresh_token = await this.generateAndSaverefresh_token(user);

      console.log(`✅ [LOGIN] Đăng nhập thành công cho user: ${user.email} (ID: ${user.id})`);

      return {
        access_token,
        refresh_token,
      };
    } catch (error: any) {
      if (error instanceof RpcException) {
        throw error;
      }

      console.error('❌ [LOGIN] Lỗi:', error?.message || error);
      throw new RpcException({
        msg: error?.message || 'Đã xảy ra lỗi trong quá trình đăng nhập',
        status: 500,
      });
    }
  }

  async validateToken(token: string): Promise<any> {
    try {
      const payload = this.jwtService.verify(token);
      
      // Giải mã sub từ JWT payload
      const userId = this.decryptId(payload.sub);
      const user: any = await this.userRepository.findById(userId);

      if (!user) {
        throw new RpcException({
          msg: 'Người dùng không tồn tại',
          status: 404,
        });
      }

      if (!user.isActive) {
        throw new RpcException({
          msg: 'Tài khoản đã bị vô hiệu hóa',
          status: 403,
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

    if (!user.isActive) {
      throw new RpcException({ msg: 'Tài khoản đã bị vô hiệu hóa', status: 403 });
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      email_verified: user.email_verified,
      github_verified: user.github_verified,
      github_installation_id: user.github_installation_id || null,
      avatar: user.avatar ?? user.github_avatar,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
  
  private async generateAndSaverefresh_token(user: any): Promise<string> {
    const refresh_token = this.jwtService.sign(
      { sub: this.encryptId(user.id) },
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
    
    // Giải mã sub từ JWT payload
    const userId = this.decryptId(payload.sub);
    const user: any = await this.userRepository.findById(userId);
    console.log('encrypted user id:', payload.sub);
    console.log('decrypted user id:', userId);
    console.log('user:', user);

    if (!user || user.refresh_token !== refresh_token) {
      throw new RpcException({
        msg: 'Refresh token không hợp lệ',
        status: 401,
      });
    }

    if (!user.isActive) {
      throw new RpcException({
        msg: 'Tài khoản đã bị vô hiệu hóa',
        status: 403,
      });
    }

    // 2. Tạo access_token mới
    // Mã hóa sub trước khi tạo JWT
    const payloadData: JwtPayload = {
      sub: this.encryptId(user.id),
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

    if (!user.isActive) {
      throw new RpcException({ msg: 'Tài khoản đã bị vô hiệu hóa', status: 403 });
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

    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }

    if (!user.isActive) {
      throw new RpcException({ msg: 'Tài khoản đã bị vô hiệu hóa', status: 403 });
    }

    // Mã hóa sub trước khi tạo JWT
    const payload: JwtPayload = {
      sub: this.encryptId(user.id),
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

    const expectedPrefix = 'sha256=';
    if (!signature.startsWith(expectedPrefix)) {
      throw new UnauthorizedException('Invalid signature format');
    }

    const payloadBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(rawBody || '', 'utf8');

    const secret = process.env.GITHUB_WEBHOOK_SECRET || 'my-webhook-secret';
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadBuffer);
    const digest = `${expectedPrefix}${hmac.digest('hex')}`;

    const sigBuffer = Buffer.from(signature, 'utf8');
    const digestBuffer = Buffer.from(digest, 'utf8');

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

  //Update password
  async updatePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<any> {
    const user: any = await this.userRepository.findById(userId);
    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }

    if (!user.isActive) {
      throw new RpcException({ msg: 'Tài khoản đã bị vô hiệu hóa', status: 403 });
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

  async CRUD(userId: any, data: any, method?: string): Promise<any> {
    const user: any = await this.userRepository.findById(userId);

    if (!user) {
      throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
    }
    if (user.role !== 'admin') { 
      throw new RpcException({ msg: 'Không có quyền thực hiện hành động này', status: 403 });
    }


    switch(method) { 
      
      case 'stats': {
        // Lấy thống kê dashboard
        try {
          // 1. Đếm tổng số user
          const totalUsers = await this.userRepo.count();

          // 2. Đếm số user active
          const activeUsers = await this.userRepo.count({
            where: { isActive: true },
          });

          // 3. Đếm số user theo role
          const adminCount = await this.userRepo.count({
            where: { role: 'admin' },
          });

          const userCount = await this.userRepo.count({
            where: { role: 'user' },
          });

          // 4. Đếm số user có liên kết GitHub
          const githubLinkedCount = await this.userRepo.count({
            where: { github_verified: true },
          });

          // 5. Lấy số user online từ Redis
          let onlineCount = 0;
          try {
            const userStatusMap = await this.redis.hgetall('user_status');
            onlineCount = Object.values(userStatusMap).filter((statusStr) => {
              try {
                const status = JSON.parse(statusStr);
                return status.online === true;
              } catch {
                return false;
              }
            }).length;
          } catch (redisError) {
            console.error('Error fetching online users from Redis:', redisError);
            // Nếu Redis lỗi, trả về 0
          }

          // 6. Đếm số user mới trong 7 ngày gần đây
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const newUsersLast7Days = await this.userRepo
            .createQueryBuilder('user')
            .where('user.created_at >= :date', { date: sevenDaysAgo })
            .getCount();

          // 7. Đếm số user đã verify email
          const emailVerifiedCount = await this.userRepo.count({
            where: { email_verified: true },
          });

          // 8. Lấy danh sách user online gần đây (top 10)
          let recentOnlineUsers:any[] = [];
          try {
            const qb = this.userRepo
              .createQueryBuilder('user')
              .select([
                'user.id',
                'user.username',
                'user.email',
                'user.avatar',
                'user.github_avatar',
              ])
              .orderBy('user.updated_at', 'DESC')
              .limit(10);

            const users = await qb.getMany();
            
            // Kiểm tra status online từ Redis
            const userStatusMap = await this.redis.hgetall('user_status');
            recentOnlineUsers = users.map((u:any) => {
              const statusStr = userStatusMap[u.id];
              let isOnline = false;
              let lastSeen = null;

              if (statusStr) {
                try {
                  const status = JSON.parse(statusStr);
                  isOnline = status.online === true;
                  lastSeen = status.lastSeen || null;
                } catch {}
              }

              return {
                id: u.id,
                username: u.username,
                email: u.email,
                avatar: u.avatar ?? u.github_avatar ?? null,
                isOnline,
                lastSeen,
              };
            });
          } catch (error) {
            console.error('Error fetching recent online users:', error);
          }

          return {
            overview: {
              totalUsers,
              activeUsers,
              inactiveUsers: totalUsers - activeUsers,
              onlineUsers: onlineCount,
            },
            usersByRole: {
              admin: adminCount,
              user: userCount,
            },
            integrations: {
              githubLinked: githubLinkedCount,
              emailVerified: emailVerifiedCount,
            },
            growth: {
              newUsersLast7Days,
            },
            recentOnlineUsers,
          };
        } catch (error) {
          console.error('Error fetching user stats:', error);
          throw new RpcException({
            msg: 'Không thể lấy thống kê người dùng',
            status: 500,
          });
        }
      }
      
      case 'create':
        // Tạo user mới
        const existingUser = await this.userRepository.findByEmail(
          data.email,
        );
        if (existingUser) {
          throw new RpcException({ msg: 'Email đã tồn tại', status: 409 });
        }
        const hashedPassword = await bcrypt.hash(data.password, 10);

        const newUser: any = await this.userRepository.create({
          ...data,
          password: hashedPassword,
        });
        await this.userRepository.save(newUser);
        break;
      case 'read-one': {
        // Đọc thông tin user
        const userToRead: any = await this.userRepository.findById(data.id);
        if (!userToRead) {
          throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
        }
        
        // Đếm số repository của user (nếu có github_installation_id)
        let totalRepositories = 0;
        if (userToRead.github_installation_id) {
          const repoRepo = this.userRepo.manager.getRepository('repositories');
          totalRepositories = await repoRepo
            .createQueryBuilder('repo')
            .where('repo.userId = :userId', { userId: userToRead.id })
            .getCount();
        }
        
        return {
          id: userToRead.id,
          username: userToRead.username ?? null,
          email: userToRead.email,
          role: userToRead.role,
          avatar: userToRead.avatar ?? userToRead.github_avatar ?? null,
          github_avatar: userToRead.github_avatar ?? null,
          email_verified: !!userToRead.email_verified,
          github_verified: !!userToRead.github_verified,
          github_installation_id: userToRead.github_installation_id ?? null,
          github_user_id: userToRead.github_user_id ?? null,
          github_email: userToRead.github_email ?? null,
          totalRepositories,
          isActive: userToRead.isActive,
          created_at: userToRead.created_at,
          updated_at: userToRead.updated_at,
        };
      }
      case 'read-all': {
        // Hỗ trợ params:
        // data.keySearch?: string
        // data.limit?: number
        // data.page?: number
        // data.order?: 'newest' | 'oldest'
        // data.role?: 'admin' | 'user' | '' (empty = all)
        // data.isActive?: 'true' | 'false' | '' (empty = all)
        const keySearch = (data?.keySearch || '').toString().trim().toLowerCase();
        const limit = Math.max(1, Math.min(200, Number(data?.limit ?? 20)));
        const page = Math.max(1, Number(data?.page ?? 1));
        const order = data?.order === 'oldest' ? 'ASC' : 'DESC';
        
        // Xử lý filter role
        const roleFilter = data?.role && data.role !== '' ? data.role : undefined;
        
        // Xử lý filter isActive - chuyển string thành boolean
        let isActiveFilter: boolean | undefined = undefined;
        if (data?.isActive !== undefined && data.isActive !== '') {
          isActiveFilter = data.isActive === 'true' || data.isActive === true;
        }

        const qb = this.userRepo.createQueryBuilder('user');

        qb.select([
          'user.id',
          'user.username',
          'user.email',
          'user.role',
          'user.avatar',
          'user.github_avatar',
          'user.email_verified',
          'user.github_verified',
          'user.github_installation_id',
          'user.created_at',
          'user.updated_at',
          'user.isActive',
        ]);

        if (keySearch) {
          qb.andWhere(
            '(LOWER(user.username) LIKE :k OR LOWER(user.email) LIKE :k)',
            { k: `%${keySearch}%` },
          );
        }

        // Filter theo role
        if (roleFilter) {
          qb.andWhere('user.role = :role', { role: roleFilter });
        }

        // Filter theo isActive
        if (typeof isActiveFilter === 'boolean') {
          qb.andWhere('user.isActive = :isActive', { isActive: isActiveFilter });
        }

        qb.orderBy('user.created_at', order as 'ASC' | 'DESC');
        qb.addOrderBy('user.id', order as 'ASC' | 'DESC');
        qb.skip((page - 1) * limit).take(limit);

        const [items, total] = await qb.getManyAndCount();

        const formatted = items.map((u: any) => ({
          id: u.id,
          username: u.username ?? null,
          email: u.email,
          role: u.role,
          avatar: u.avatar ?? u.github_avatar ?? null,
          github_avatar: u.github_avatar ?? null,
          email_verified: !!u.email_verified,
          github_verified: !!u.github_verified,
          github_installation_id: u.github_installation_id ?? null,
          isActive: u.isActive,
          created_at: u.created_at,
          updated_at: u.updated_at,
        }));

        const hasMore = page * limit < total;

        return {
          items: formatted,
          total,
          page,
          limit,
          hasMore,
        };
      }
      case 'update':
        // Cập nhật thông tin user
        const userToUpdate: any = await this.userRepository.findById(data.userId);
        if (!userToUpdate) {
          throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
        }
        // Chỉ cập nhật các trường hợp lệ
        if (data.username !== undefined) userToUpdate.username = data.username;
        if (data.email !== undefined) userToUpdate.email = data.email;
        if (data.github_verified !== undefined)
          userToUpdate.github_verified = data.github_verified;
        await this.userRepository.save(userToUpdate);
        break;
      case 'delete': {
        const userToDelete: any = await this.userRepository.findById(data.id);
        if (!userToDelete) {
          throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
        }

        // Validations
        if (userToDelete.email === 'admin@example.com') {
          throw new RpcException({
            msg: 'Không thể xóa tài khoản root admin',
            status: 403,
          });
        }

        if (userToDelete.id === userId) {
          throw new RpcException({
            msg: 'Không thể xóa tài khoản của chính bạn',
            status: 403,
          });
        }

        try {
          // Sử dụng QueryRunner với TypeORM entities
          const queryRunner = this.userRepo.manager.connection.createQueryRunner();
          
          await queryRunner.connect();
          await queryRunner.startTransaction();

          try {
            // 1. Xóa channel memberships
            await queryRunner.manager
              .createQueryBuilder()
              .delete()
              .from('channel_members')
              .where('user_id = :userId', { userId: userToDelete.id })
              .execute();

            // 2. Xóa messages
            await queryRunner.manager
              .createQueryBuilder()
              .delete()
              .from('messages')
              .where('senderId = :userId', { userId: userToDelete.id })
              .execute();

            // 3. Update channels owner
            await queryRunner.manager
              .createQueryBuilder()
              .update('channels')
              .set({ owner: null })
              .where('owner.id = :userId', { userId: userToDelete.id })
              .execute();

            // 4. Xóa user
            await queryRunner.manager
              .createQueryBuilder()
              .delete()
              .from('users')
              .where('id = :id', { id: userToDelete.id })
              .execute(); 

            await queryRunner.commitTransaction();

            return {
              msg: 'Đã xóa người dùng thành công',
              userId: userToDelete.id,
            };
          } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
          } finally {
            await queryRunner.release();
          }
        } catch (error) {
          console.error('Error deleting user:', error);
          throw new RpcException({
            msg: 'Không thể xóa người dùng: ' + error,
            status: 500,
          });
        }
      }
      case 'toggle-active': {
        // data.userId required
        const targetUser: any = await this.userRepository.findById(data.id);
        if (!targetUser) {
          throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
        }

        // Chỉ cho phép toggle với role 'user'
        if (String(targetUser.role) !== 'user') {
          throw new RpcException({
            msg: 'Chỉ có thể bật/tắt tài khoản có role "user"',
            status: 403,
          });
        }

        // Đảo trạng thái isActive
        targetUser.isActive = !targetUser.isActive;
        await this.userRepository.save(targetUser);

        return {
          msg: `Đã ${targetUser.isActive ? 'kích hoạt' : 'vô hiệu hóa'} tài khoản`,
          userId: targetUser.id,
          isActive: targetUser.isActive,
        };
      }
      case 'set-toggle-admin': {
        // data.id required
        const targetUser: any = await this.userRepository.findById(data.id);
        if (!targetUser) {
          throw new RpcException({ msg: 'Không tìm thấy người dùng', status: 404 });
        }

        // Không cho phép toggle admin cho root admin
        if (targetUser.email === 'admin@example.com') {
          throw new RpcException({
            msg: 'Không thể thay đổi quyền của tài khoản root admin',
            status: 403,
          });
        }

        // Đảo role giữa admin và user
        if (targetUser.role === 'admin') {
          targetUser.role = 'user';
        } else {
          targetUser.role = 'admin';
        }
        
        await this.userRepository.save(targetUser);

        return {
          msg: `Đã ${targetUser.role === 'admin' ? 'cấp quyền admin' : 'thu hồi quyền admin'} cho tài khoản`,
          userId: targetUser.id,
          role: targetUser.role,
        };
      }
        
      default:
        break;
    }
  }

}
