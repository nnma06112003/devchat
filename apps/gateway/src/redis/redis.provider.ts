import { Provider } from '@nestjs/common';
import Redis from 'ioredis';

export const RedisProvider: Provider = {
  provide: 'REDIS_CLIENT',
  useFactory: async () => {
    return new Redis({
      host: 'localhost',  // chỉnh theo config của bạn
      port: 6379,
    });
  },
};
