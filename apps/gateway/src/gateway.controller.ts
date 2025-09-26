import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Req,
  Res,
  Inject
} from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Request, Response } from 'express';
import { ChatSocketService } from './socket.service';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

type StatePayload = { next: string; userId: string | number };

function encodeState(obj: StatePayload) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function decodeState(raw?: string): StatePayload | null {
  if (!raw) return null;
  try {
    const s = raw.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(s, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Tất cả HTTP từ FE đi qua controller này → định tuyến tới Kafka
@Controller('api')
export class GatewayController {
  // FE: GET /api/channels/unread-map
  constructor(
    private readonly gw: GatewayService,
    private readonly ChatSocketService: ChatSocketService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('github-app/redirect')
  async githubAppRedirect(@Req() req: Request) {
    const user = req.user as any;
    const state = encodeState({
      next: process.env.FE_URL!,
      userId: user.id,
    });
    const result: any = await this.gw.exec('git', 'get_install_app_url', {
      state,
    });
    return { url: result.data };
  }

  @Get('github-app/setup')
  async setup(
    @Query('installation_id') installationId: string,
    @Query('setup_action') setupAction: string,
    @Query('state') state: string,
    @Res() res: any,
  ) {
    // Giải mã state nếu bạn encode userId/redirect
    const stateDecoded: any = decodeState(state);
    if (!stateDecoded || !stateDecoded.userId) {
      return res.redirect();
    }
    const payload = {
      user: { id: stateDecoded.userId },
      github_installation_id: installationId,
    };
    await this.gw.exec('auth', 'update_profile', payload);
    await this.gw.exec('git', 'github_app_setup', {
      userId: stateDecoded.userId,
      installationId,
      userToken: null,
    });
    const result: any = await this.gw.exec('auth', 'get_token_info', {
      userId: stateDecoded.userId,
    });
    if (result && result?.data) {
      const access_token = result.data.access_token;
      const refresh_token = result.data.refresh_token;
      return res.redirect(
        `${process.env.FE_URL}/auth/github/callback?access_token=${access_token}&refresh_token=${refresh_token}`,
      );
    } else {
      return res.redirect(process.env.FE_URL);
    }
  }

  // ---------- AUTH ----------
  // FE: POST /api/auth/github_oauth?code=...
  @Get('auth/github-oauth/redirect')
  async githubOAuthRedirect() {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const callbackUrl = process.env.GITHUB_CALLBACK_URL;
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=user:email&redirect_uri=${callbackUrl}`;
    return { url };
  }

  @Get('auth/github-oauth/callback')
  async githubOAuthCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code: string,
    @Query('state') state?: string,
  ) {
    const safeReq = {
      session: (req as any).session,
      headers: req.headers,
      user: (req as any).user,
    };
    const result: any = await this.gw.exec('git', 'github_oauth_callback', {
      req: safeReq,
      code,
      state: state ?? undefined,
    });
    if (result?.data && result.data.user) {
      const isInstall = result.data.isInstall;
      if (isInstall) {
        return res.redirect(result?.data?.nextUrl);
      } else {
        const tokenInfo: any = await this.gw.exec('auth', 'get_token_info', {
          userId: result?.data?.user?.id,
        });
        if (tokenInfo && tokenInfo?.data) {
          const access_token = tokenInfo.data.access_token;
          const refresh_token = tokenInfo.data.refresh_token;
          return res.redirect(
            `${process.env.FE_URL}/auth/github/callback?access_token=${access_token}&refresh_token=${refresh_token}`,
          );
        } else {
          return res.redirect(`${process.env.FE_URL}`);
        }
      }
    }
  }

  // FE: POST /api/auth/login
  // Body: { email: string, password: string, otp?: string }
  @Post('auth/login')
  async login(@Body() dto: any) {
    // uỷ quyền cho AuthService: { cmd: 'login' }
    return this.gw.exec('auth', 'login', dto);
  }

  @Post('auth/register')
  async register(@Body() dto: any) {
    return this.gw.exec('auth', 'register', dto);
  }
  @UseGuards(JwtAuthGuard)
  @Post('auth/update-profile')
  async update_profile(@Body() dto: any, @Req() req: Request) {
    // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('auth', 'update_profile', payload);
  }
  // FE: POST /api/auth/get_profile
  // Body: { userId: string }
  @UseGuards(JwtAuthGuard)
  @Post('auth/get-profile')
  async get_profile(@Req() req: Request) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };
    // Lấy map chưa đọc từ Redis
    return this.gw.exec('auth', 'get_profile', { userId: user.id });
  }

  // FE: POST /api/auth/refresh
  // Body: { refreshToken: string }
  @Post('auth/refresh-token')
  async refresh(@Body() dto: any) {
    return this.gw.exec('auth', 'refresh', dto);
  }

  // FE: POST /api/auth/verify-token

  // @Post('auth/verify-token')
  // async verifyToken(@Body() dto: { token: string }) {
  //   return this.gw.exec('auth', 'verify_token', dto);
  // }

  @Get('auth/confirm-email')
  async confirmEmail(@Query() dto: { token: string }) {
    return this.gw.exec('auth', 'confirm_email', dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('channels/join-channel')
  async joinChannel(@Body() dto: any, @Req() req: Request) {
    // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('chat', 'joinChannel', payload);
  }
  // ---------- CHAT ----------
  // FE: POST /api/channels/:channelId/messages
  // Body: { text: string, snippetId?: string }
  // Param: channelId: string
  @UseGuards(JwtAuthGuard)
  @Post('channels/create-channel')
  async createChannel(@Body() dto: any, @Req() req: Request) {
    // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('chat', 'createChannel', payload);
  }

  @UseGuards(JwtAuthGuard)
  @Get('channels/unread-map')
  async getUnreadMap(@Req() req: Request) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };
    // Lấy map chưa đọc từ Redis
    // Trả về { channelId: count }
    const data = await this.ChatSocketService.getRegisteredUnreadChannels(
      user.id,
    );
    return { code: 200, msg: 'Success', data };
  }
  // ---------- CHAT ----------
  // FE: POST /api/channels/:channelId/messages
  // Body: { text: string, snippetId?: string }
  // Param: channelId: string
  // @UseGuards(JwtAuthGuard)
  // @Post('channels/send-messages')
  // async sendMessage(@Body() dto: any, @Req() req: Request) {
  //   // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
  //   const user = req.user as any;
  //   const payload = { user, ...dto };
  //   return this.gw.exec('chat', 'sendMessage', payload);
  // }

  @UseGuards(JwtAuthGuard)
  @Post('channels/add-repositories')
  async addRepositoriesToChannel(@Body() dto: any, @Req() req: Request) {
    // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('chat', 'addRepositoriesToChannel', payload);
  }

  @UseGuards(JwtAuthGuard)
  @Post('channels/remove-repositories')
  async removeRepositoriesFromChannel(@Body() dto: any, @Req() req: Request) {
    // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('chat', 'removeRepositoriesFromChannel', payload);
  }

  // FE: GET /api/channels/:channelId/messages
  // Param: channelId: string
  // Query: { cursor?: string }
  @UseGuards(JwtAuthGuard)
  @Get('channels/list-channels')
  async listChannels(
    @Query() q: any,
    @Req() req: Request, // 👈 lấy request
  ) {
    const user = req.user as any; // JwtAuthGuard đã inject user vào đây
    return this.gw.exec('chat', 'listChannels', {
      user, // 👈 truyền userId sang service chat
      ...q,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/list-online')
  async listOnlineUser() {
    // JwtAuthGuard đã inject user vào đây
    return this.gw.getAllOnlineUsers();
  }

  @UseGuards(JwtAuthGuard)
  @Get('channels/list-messages/:channel_id')
  async listMessages(
    @Param('channel_id') channel_id: string,
    @Query() q: any,
    @Req() req: Request, // 👈 lấy request
  ) {
    const user = req.user as any; // JwtAuthGuard đã inject user vào đây
    return this.gw.exec('chat', 'listChannelsMessages', {
      user, // 👈 truyền userId sang service chat
      channel_id,
      ...q,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('channels/search-chat')
  async SearchChat(
    @Query() q: any,
    @Req() req: Request, // 👈 lấy request
  ) {
    const user = req.user as any; // JwtAuthGuard đã inject user vào đây
    return this.gw.exec('chat', 'searchChatEntities', {
      user,
      data: { key: q?.key, type: q?.type ?? '', limit: q?.limit ?? 5 },
      ...q,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/search-user')
  async SearchUsers(
    @Query() q: any,
    @Req() req: Request, // 👈 lấy request
  ) {
    const user = req.user as any; // JwtAuthGuard đã inject user vào đây
    return this.gw.exec('auth', 'searchUsers', {
      user,
      data: { key: q?.key, limit: q?.limit ?? 5 },
      ...q,
    });
  }

  //Upload file
  @UseGuards(JwtAuthGuard)
  @Post('upload/get-presigned-url')
  async getPresignedUrl(@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('upload', 'getPresignedUrl', payload);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload/get-object-url')
  async getObjectUrl(@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('upload', 'getObject', payload);
  }

  // GITHUB
  @UseGuards(JwtAuthGuard)
@Post('git/get_repo_installation')
async get_repo_installation(@Req() req: Request) {
  const user = req.user as any;
  if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };

  // Tạo cache key duy nhất theo user
  const cacheKey = `repo_installation:${user.id}`;
  const cached = await this.cacheManager.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await this.gw.exec('git', 'get_repo_installation', { userId: user.id });

  // Lưu cache với TTL 60 giây
  await this.cacheManager.set(cacheKey, result);

  return result;
}

  @UseGuards(JwtAuthGuard)
  @Post('git/get_repo_data_by_url')
  async get_repo_data_by_url(@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };
    return this.gw.exec('git', 'get_repo_data_by_url', {
      userId: user.id,
      url: dto.url,
      ...dto,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('git/get_list_repo_data_by_channel')
  async get_list_repo_data_by_channel(@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };

    // Tạo cache key duy nhất theo user và dto
    const cacheKey = `repo_data_by_channel:${user.id}:${JSON.stringify(dto)}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.gw.exec('chat', 'listRepositoriesByChannel', {
      user,
      ...dto,
    });

    if (result && result.data) {
      if (Array.isArray(result.data.items) && result.data.items.length > 0) {
        const data = await this.gw.exec('git', 'get_repo_by_ids', {
          items: result.data.items,
        });
        // Lưu cache
        await this.cacheManager.set(cacheKey, data); // TTL 60s
        return data;
      } else {
        const data = { code: 200, msg: 'Success', data: [] };
        await this.cacheManager.set(cacheKey, data);
        return data;
      }
    } else {
      const data = { code: 404, msg: 'Not Found', data: null };
      await this.cacheManager.set(cacheKey, data);
      return data;
    }
  }
}
