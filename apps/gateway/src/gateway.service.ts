import {
  Injectable,
  Inject,
  OnModuleInit,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { lastValueFrom, timeout } from 'rxjs';

@Injectable()
export class GatewayService implements OnModuleInit {
  constructor(
    @Inject('KAFKA_GATEWAY') private readonly kafka: ClientKafka,
    @Inject('GATEWAY_TOPICS') private readonly topics: string[],
  ) {}

  async onModuleInit() {
    this.topics.forEach((t) => this.kafka.subscribeToResponseOf(t));
    await this.kafka.connect();
  }

  async exec(
    service: string,
    cmd: string,
    data: any,
    opts?: { waitMs?: number },
  ) {
    const topic = `svc.${service}.exec`;
    const wait = opts?.waitMs ?? 50000;

    try {
      const res$ = this.kafka
        .send<any, any>(topic, { cmd, data })
        .pipe(timeout(wait));
      return await lastValueFrom(res$);
    } catch (err: any) {
      // Kafka + RpcException => dữ liệu thực tế nằm trong err.response
      const payload = err?.response ?? err?.message ?? err;

      if (payload?.status) {
        // Đây chính là object RpcException từ service trả về
        throw new HttpException(
          {
            code: payload.status,
            msg: payload.msg,
            data: null,
          },
          payload.status,
        );
      }

      // Timeout
      if (err?.name === 'TimeoutError') {
        throw new HttpException(
          {
            code: 'REQUEST_TIMEOUT',
            msg: `Service ${service} không phản hồi trong ${wait}ms`,
          },
          504,
        );
      }

      // Fallback
      throw new HttpException(
        { code: 'UNEXPECTED_ERROR', msg: JSON.stringify(payload) },
        500,
      );
    }
  }

  emit(service: string, cmd: string, data: any) {
    const topic = `svc.${service}.exec`;
    return this.kafka.emit(topic, { cmd, data });
  }
}
