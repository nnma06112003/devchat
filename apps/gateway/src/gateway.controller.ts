import { Body, Controller, Get, Param, Post, Query, UseGuards ,Req  } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Request } from 'express';

// Tất cả HTTP từ FE đi qua controller này → định tuyến tới Kafka
@Controller('api')
export class GatewayController {
  constructor(private readonly gw: GatewayService) {}

  // ---------- AUTH ----------
  // FE: POST /api/auth/github_oauth?code=...
  @Get('auth/github-oauth')
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
    @Req() req: Request,   // 👈 lấy request
  ) {
    const user = req.user as any; // JwtAuthGuard đã inject user vào đây
    return this.gw.exec('chat', 'listChannels', {
      user,   // 👈 truyền userId sang service chat
      ...q,
    });
  }



  @UseGuards(JwtAuthGuard)
  @Get('channels/list-messages/:channel_id')
  async listMessages(
    @Param('channel_id') channel_id: string, 
    @Query() q: any,
    @Req() req: Request,   // 👈 lấy request
  ) {
    const user = req.user as any; // JwtAuthGuard đã inject user vào đây
    return this.gw.exec('chat', 'listChannelsMessages', {
      user,   // 👈 truyền userId sang service chat
      channel_id,
      ...q,
    });
  }

  
}
