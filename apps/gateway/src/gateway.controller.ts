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
  Inject,
  HttpCode,
  Headers,
} from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Request, Response } from 'express';
import { ChatSocketService } from './socket.service';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { KafkaService } from './kafka/kafka.service';

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

function verifySignature(
  secret: string,
  bodyRaw: Buffer,
  signature256: string,
): boolean {
  const hmac = createHmac('sha256', secret).update(bodyRaw).digest('hex');
  const expected = Buffer.from(`sha256=${hmac}`, 'utf8');
  const received = Buffer.from(signature256 || '', 'utf8');
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

// Tất cả HTTP từ FE đi qua controller này → định tuyến tới Kafka
@Controller('api')
export class GatewayController {
  // FE: GET /api/channels/unread-map
  constructor(
    private readonly gw: GatewayService,
    private readonly ChatSocketService: ChatSocketService,
    private readonly kafka: KafkaService,
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

  @UseGuards(JwtAuthGuard)
  @Post('github-app/uninstall')
  async githubAppUninstall(@Req() req: Request) {
    const user = req.user as any;
    return await this.gw.exec('git', 'unlink_github_app', {
      userId: user.id,
    });
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

  //github webhook
  @Post('github-app/webhook')
  @HttpCode(200)
  @HttpCode(201)
  async handle(
    @Req() req: any,
    @Res() res: any,
    @Headers('x-hub-signature-256') sig256: string,
    @Headers('x-github-event') ghEvent: string,
    @Headers('x-github-delivery') deliveryId: string,
  ) {
    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET || 'ppB6va3mMw';
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body));

    // Verify chữ ký GitHub
    if (!verifySignature(secret, raw, sig256)) {
      return res.status(401).send('Invalid signature');
    }

    const payload = JSON.parse(raw.toString());

    console.log('Webhook payload', payload);

    if (payload.commits) {
      payload.commits.forEach((commit: any) => {
        console.log('Commit:', commit.id);
        console.log('Message:', commit.message);
        console.log('Added:', commit.added);
        console.log('Modified:', commit.modified);
        console.log('Removed:', commit.removed);
      });
    }

    // Chuẩn hoá message để gửi đi
    const message = {
      deliveryId,
      event: ghEvent, // ví dụ: "pull_request"
      action: payload.action, // ví dụ: "opened"
      installationId: payload.installation?.id,
      repoId: payload.repository?.id,
      repoFullName: payload.repository?.full_name,
      createdAt: new Date().toISOString(),
      data: payload, // giữ nguyên payload gốc
    };

    // Publish vào Kafka topic
    await this.kafka.publish('github.webhooks', message);

    return res.send('OK');
  }

  @UseGuards(JwtAuthGuard)
  @Get('github/commit/:owner/:repo/:sha')
  async getCommitDetails(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('sha') sha: string,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    return this.gw.exec('git', 'getCommitDetails', {
      userId: user.id,
      owner,
      repo,
      sha,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('github/compare/:owner/:repo/:base/:head')
  async compareCommits(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('base') base: string,
    @Param('head') head: string,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    return this.gw.exec('git', 'compareCommits', {
      userId: user.id,
      owner,
      repo,
      base,
      head,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('github/commit-diff/:owner/:repo/:sha')
  async getCommitDiff(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('sha') sha: string,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };

    return this.gw.exec('git', 'getCommitDiff', {
      userId: user.id,
      owner,
      repo,
      sha,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('github/commit-analysis/:owner/:repo/:sha')
  async getCommitAnalysis(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('sha') sha: string,
    @Query('prompt') prompt: string,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };

    const result = await this.gw.exec('git', 'getCommitAnalysis', {
      userId: user.id,
      owner,
      repo,
      sha,
      prompt: prompt ?? '',
    });

    return result;
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

  @UseGuards(JwtAuthGuard)
  @Post('auth/github-oauth/redirect-update')
  async githubOAuthRedirectUpdate(@Req() req: Request) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };
    const clientId = process.env.GITHUB_CLIENT_ID;
    const callbackUrl = process.env.GITHUB_CALLBACK_URL;
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=user:email&redirect_uri=${callbackUrl}&state=${user.id}`;

    return { url };
  }

  @Get('auth/github-oauth/callback')
  async githubOAuthCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code: string,
    @Query('state') state?: string,
  ) {
    try {
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
    } catch {
      return res.redirect(`${process.env.FE_URL}/error?error=githuboauth`);
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

  @UseGuards(JwtAuthGuard)
  @Post('auth/update-password')
  async update_password(@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    return this.gw.exec('auth', 'update_password', { user, ...dto });
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
  @Post('channels/update-channel')
  async updateChannel(@Body() dto: any, @Req() req: Request) {
    // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('chat', 'updateChannel', payload);
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
  @Post('channels/repository-channels')
  async listChannelsByRepository (@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('chat', 'listChannelsByRepository', payload);
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

  // Thêm thành viên vào channel
  @UseGuards(JwtAuthGuard)
  @Post('channels/add-members')
  async addMembersToChannel(@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('chat', 'addMembersToChannel', payload);
  }

  @UseGuards(JwtAuthGuard)
  @Post('channels/remove-members')
  async removeMembersFromChannel(@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('chat', 'removeMembersFromChannel', payload);
  }

  @UseGuards(JwtAuthGuard)
  @Get('channels/:channelId/list-non-members')
  async listNonMembers(
    @Param('channelId') channelId: string,
    @Query('username') username: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.gw.exec('chat', 'listNonMembers', {
      channelId,
      username,
      limit,
      cursor,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('messages/search')
  async searchMessages(
    @Query('query') query: string,
    @Req() req: Request,
    @Query('channelId') channelId?: string,
    @Query('senderId') senderId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };

    return this.gw.exec('chat', 'searchMessages', {
      userId: user.id,
      query,
      channelId: channelId ? +channelId : undefined,
      senderId: senderId ? +senderId : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? +limit : undefined,
      cursor: cursor ? +cursor : undefined,
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

  @UseGuards(JwtAuthGuard)
  @Post('upload/get-avatar-presigned-url')
  async getAvatarPresignedUrl(
    @Body() body: { filename: string; contentType: string },
    @Req() req: Request,
  ) {
    const user = req.user as any;
    return this.gw.exec('upload', 'getAvatarPresignedUrl', {
      userId: user.id,
      filename: body.filename,
      contentType: body.contentType,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload/get-sheet-url')
  async getSheetUrl(@Body() body: { channelId: string }, @Req() req: Request) {
    const user = req.user as any;

    return this.gw.exec('upload', 'getSheetUrl', {
      channelId: body.channelId,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('channels/:channelId/attachments')
  async getAttachmentsByChannel(
    @Param('channelId') channelId: string,
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('filename') filename?: string,
    @Query('mimeType') mimeType?: string,
    @Query('senderId') senderId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };

    return this.gw.exec('upload', 'getAttachmentsByChannel', {
      channelId: +channelId,
      limit: limit ? +limit : undefined,
      cursor: cursor ? +cursor : undefined,
      filename,
      mimeType,
      senderId: senderId ? +senderId : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
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

    const result = await this.gw.exec('git', 'get_repo_installation', {
      userId: user.id,
    });

    // Lưu cache với TTL 60 giây
    await this.cacheManager.set(cacheKey, result);

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post('git/get_repo_data_by_url')
  async get_repo_data_by_url(@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };
    const cacheKey = `repo_data_by_url:${user.id}:${dto.url}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached;
    }
    const result = await this.gw.exec('git', 'get_repo_data_by_url', {
      userId: user.id,
      url: dto.url,
      ...dto,
    });
    await this.cacheManager.set(cacheKey, result, 3 * 60 * 1000); // 3 phút
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post('git/get_list_repo_data_by_channel')
  async get_list_repo_data_by_channel(@Body() dto: any, @Req() req: Request) {
    const user = req.user as any;
    if (!user?.id) return { code: 401, msg: 'Unauthorized', data: null };

    // 1. Lấy danh sách repo id từ chat service
    const result = await this.gw.exec('chat', 'listRepositoriesByChannel', {
      user,
      ...dto,
    });

    if (!result?.data) {
      return { code: 404, msg: 'Not Found', data: null };
    }

    const items: string[] = result.data.items || [];

    // 2. Tạo snapshot hash cho items
    const itemsHash = createHash('sha1')
      .update(JSON.stringify(items))
      .digest('hex');

    const cacheKeySnapshot = `repo_snapshot:${user.id}:${JSON.stringify(dto)}`;
    const cacheKeyData = `repo_data_by_channel:${user.id}:${JSON.stringify(dto)}`;

    // 3. Kiểm tra snapshot cũ
    const oldSnapshot = await this.cacheManager.get<string>(cacheKeySnapshot);

    if (oldSnapshot && oldSnapshot === itemsHash) {
      // Snapshot không đổi => lấy cache data
      const cached = await this.cacheManager.get<any>(cacheKeyData);
      if (cached) {
        return cached;
      }
    }

    // 4. Nếu snapshot khác hoặc cache trống => gọi Git
    let data: any;
    if (items.length > 0) {
      data = await this.gw.exec('git', 'get_repo_by_ids', { items });
    } else {
      data = { code: 200, msg: 'Success', data: [] };
    }

    // 5. Cập nhật cache
    await this.cacheManager.set(cacheKeySnapshot, itemsHash, 10 * 60 * 1000); // 10 phút
    await this.cacheManager.set(cacheKeyData, data, 3 * 60 * 1000); // 3 phút

    return data;
  }

  //Notification
  @UseGuards(JwtAuthGuard)
  @Get('notifications')
  async getNotifications(@Query() query: any, @Req() req: Request) {
    const user = req.user as any;
    return this.gw.exec('notification', 'get_notifications', {
      userId: user.id,
      query,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('notifications/mark-as-read')
  async markAsRead(@Body() body: any, @Req() req: Request) {
    const user = req.user as any;
    console.log('Body mark as read:', body.id);
    return this.gw.exec('notification', 'mark_as_read', {
      notificationId: body.id,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('notifications/mark-all-as-read')
  async markAllAsRead(@Req() req: Request) {
    const user = req.user as any;
    return this.gw.exec('notification', 'mark_all_as_read', {
      userId: user.id,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('notifications/count-unread')
  async countUnreadNotifications(@Req() req: Request) {
    const user = req.user as any;
    return this.gw.exec('notification', 'get_number_unread_notifications', {
      userId: user.id,
    });
  }
}
