// src/notification.controller.ts
import { Controller, Get, Param, Sse } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { NotificationService } from './notifications.service';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Controller()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @MessagePattern('svc.notification.exec')
  async handle(@Payload() message: { cmd: string; data: any }) {
    const { cmd, data } = message || {};
    switch (cmd) {
      case 'send_message_notification':
        return this.notificationService.createNotification(data.data);
      default:
        return { ok: false, error: `Unknown cmd: ${cmd}` };
    }
  }
}
