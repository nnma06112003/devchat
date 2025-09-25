import { Controller, Sse, MessageEvent, Req, UseGuards } from '@nestjs/common';
import { Observable, fromEvent } from 'rxjs';
import { map, filter, tap } from 'rxjs/operators';
import { KafkaConsumerService } from './kafka-consumer.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Request } from 'express';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly kafkaConsumer: KafkaConsumerService) {}

  @UseGuards(JwtAuthGuard)
  @Sse('stream')
  stream(@Req() req: Request): Observable<MessageEvent> {
    const userId = (req.user as any).id;
    const userIdStr = String(userId);
    console.log('User connected to SSE stream:', userId);

    return fromEvent(this.kafkaConsumer, 'notification').pipe(
      tap((m: any) =>
        console.log('kafka->sse raw message:', JSON.stringify(m)),
      ),
      filter((msg: any) => {
        // hỗ trợ nhiều shape payload và so sánh bằng string để tránh mismatch kiểu (number vs string)
        const candidate =
          msg?.userId ??
          msg?.data?.userId ??
          msg?.payload?.userId ??
          msg?.toUserId ??
          null;
        const ok = candidate != null && String(candidate) === userIdStr;
        if (!ok) {
          // debug: cho thấy vì sao message bị filter
          console.log(
            'sse filter out, candidate:',
            candidate,
            'expected:',
            userIdStr,
          );
        }
        return ok;
      }),
      map((msg: any) => ({
        data: msg?.data ?? msg?.payload ?? msg,
      })),
    );
  }
}
