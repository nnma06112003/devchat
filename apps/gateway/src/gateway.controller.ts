import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { JwtGuard } from './guards/jwt-auth.guard';

// Tất cả HTTP từ FE đi qua controller này → định tuyến tới Kafka
@Controller('api')
export class GatewayController {
  constructor(private readonly gw: GatewayService) {}

  // ---------- AUTH ----------
  // FE: POST /api/auth/github_oauth?code=...
  @Get('auth/github_oauth')
async githubOAuth(@Query('code') code: string) {
  // gọi AuthService qua Kafka
  return this.gw.exec('auth', 'github_oauth', { code });
}
  // FE: POST /api/auth/login
  // Body: { email: string, password: string, otp?: string }
  @Post('auth/login')
  async login(@Body() dto: any) {
    // uỷ quyền cho AuthService: { cmd: 'login' }
    return this.gw.exec('auth', 'login', dto);
  }

  // FE: POST /api/auth/get_profile
  // Body: { userId: string }
  @Post('auth/get_profile')
  async get_profile(@Body() dto: any) {
    return this.gw.exec('auth', 'get_profile', dto);
  }

  // FE: POST /api/auth/refresh
  // Body: { refreshToken: string }
  @Post('auth/refresh')
  async refresh(@Body() dto: any) {
    return this.gw.exec('auth', 'refresh', dto);
  }

  // ---------- CHAT ----------
  // FE: POST /api/channels/:channelId/messages
  // Body: { text: string, snippetId?: string }
  // Param: channelId: string
  @UseGuards(JwtGuard)
  @Post('channels/:channelId/messages')
  async sendMessage(@Param('channelId') channelId: string, @Body() dto: any) {
    // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
    const payload = { channelId, ...dto };
    return this.gw.exec('chat', 'sendMessage', payload);
  }

  // FE: GET /api/channels/:channelId/messages
  // Param: channelId: string
  // Query: { cursor?: string }
  @UseGuards(JwtGuard)
  @Get('channels/:channelId/messages')
  async listMessages(@Param('channelId') channelId: string, @Query() q: any) {
    return this.gw.exec('chat', 'listMessages', { channelId, ...q });
  }

  // FE: POST /api/channels
  // Body: { name: string, visibility: string, members: string[] }
  @UseGuards(JwtGuard)
  @Post('channels')
  async createChannel(@Body() dto: any) {
    return this.gw.exec('chat', 'createChannel', dto);
  }

  // (mở rộng) SEARCH, FILE, NOTIFICATION... tương tự
}
