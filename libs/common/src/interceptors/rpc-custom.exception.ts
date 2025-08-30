import { RpcException } from '@nestjs/microservices';

export class RpcCustomException extends RpcException {
  constructor(message: string, status = 400) {
    super({ message, status });
  }
}
