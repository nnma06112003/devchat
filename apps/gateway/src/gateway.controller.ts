import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Request } from 'express';
import { ChatSocketService } from './socket.service';
import { FileInterceptor } from '@nestjs/platform-express';

// Tất cả HTTP từ FE đi qua controller này → định tuyến tới Kafka
@Controller('api')
export class GatewayController {
  // FE: GET /api/channels/unread-map
  constructor(
    private readonly gw: GatewayService,
    private readonly ChatSocketService: ChatSocketService,
  ) {}

  // ---------- AUTH ----------
  // FE: POST /api/auth/github_oauth?code=...
  @Post('auth/github-oauth')
  async githubOAuth(@Body('code') code: string) {
    // gọi AuthService qua Kafka
    return this.gw.exec('auth', 'github_oauth', code);
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

  // FE: POST /api/auth/get_profile
  // Body: { userId: string }
  @Post('auth/get-profile')
  async get_profile(@Body() dto: any) {
    return this.gw.exec('auth', 'get_profile', dto);
  }

  // FE: POST /api/auth/refresh
  // Body: { refreshToken: string }
  @Post('auth/refresh-token')
  async refresh(@Body() dto: any) {
    return this.gw.exec('auth', 'refresh', dto);
  }

  // FE: POST /api/auth/verify-token

  @Post('auth/verify-token')
  async verifyToken(@Body() dto: { token: string }) {
    return this.gw.exec('auth', 'verify_token', dto);
  }

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
  @UseGuards(JwtAuthGuard)
  @Post('channels/send-messages')
  async sendMessage(@Body() dto: any, @Req() req: Request) {
    // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
    const user = req.user as any;
    const payload = { user, ...dto };
    return this.gw.exec('chat', 'sendMessage', payload);
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
}
