import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { JwtGuard } from './guards/jwt-auth.guard';

// Tất cả HTTP từ FE đi qua controller này → định tuyến tới Kafka
@Controller('api')
export class GatewayController {
  constructor(private readonly gw: GatewayService) {}

  // ---------- AUTH ----------
  // FE: POST /api/auth/login  { email, password, otp? }
  @Post('auth/login')
  async login(@Body() dto: any) {
    // uỷ quyền cho AuthService: { cmd: 'login' }
    return this.gw.exec('auth', 'login', dto);
  }

  // FE: POST /api/auth/refresh { refreshToken }
  @Post('auth/get_profile')
  async get_profile(@Body() dto: any) {
    return this.gw.exec('auth', 'get_profile', dto);
  }

   @Post('auth/refresh')
  async refresh(@Body() dto: any) {
    return this.gw.exec('auth', 'refresh', dto);
  }

  // ---------- CHAT ----------
  // FE: POST /api/channels/:channelId/messages { text, snippetId? }
  @UseGuards(JwtGuard)
  @Post('channels/:channelId/messages')
  async sendMessage(@Param('channelId') channelId: string, @Body() dto: any) {
    // Đính kèm user từ JWT để ChatService kiểm soát quyền truy cập kênh
    const payload = { channelId, ...dto };
    return this.gw.exec('chat', 'sendMessage', payload);
  }

  // FE: GET /api/channels/:channelId/messages?cursor=...
  @UseGuards(JwtGuard)
  @Get('channels/:channelId/messages')
  async listMessages(@Param('channelId') channelId: string, @Query() q: any) {
    return this.gw.exec('chat', 'listMessages', { channelId, ...q });
  }

  // FE: POST /api/channels { name, visibility, members[] }
  @UseGuards(JwtGuard)
  @Post('channels')
  async createChannel(@Body() dto: any) {
    return this.gw.exec('chat', 'createChannel', dto);
  }

  // (mở rộng) SEARCH, FILE, NOTIFICATION... tương tự
}
