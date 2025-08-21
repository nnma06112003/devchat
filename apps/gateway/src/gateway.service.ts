import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { lastValueFrom, timeout } from 'rxjs';

@Injectable()
export class GatewayService implements OnModuleInit {
  constructor(
    @Inject('KAFKA_GATEWAY') private readonly kafka: ClientKafka,
    @Inject('GATEWAY_TOPICS') private readonly topics: string[],
  ) {}

  async onModuleInit() {
    // Đăng ký các topic cần pattern request-reply trước khi connect
    this.topics.forEach(t => this.kafka.subscribeToResponseOf(t));
    await this.kafka.connect();
  }
    // Gửi message tới topic và chờ phản hồi
  async exec(service: string, cmd: string, data: any, opts?: { waitMs?: number }) {
    const topic = `svc.${service}.exec`;
    const wait = opts?.waitMs ?? 5000;

    const res = this.kafka.send<any, any>(topic, { cmd, data }).pipe(timeout(wait));
    return await lastValueFrom(res);
  }

  emit(service: string, cmd: string, data: any) {
    const topic = `svc.${service}.exec`;
    return this.kafka.emit(topic, { cmd, data });
  }
}
