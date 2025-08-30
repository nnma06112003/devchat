import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class RpcResponseInterceptor<T>
  implements NestInterceptor<T, { status: number; msg: string; data: T }>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<{ status: number; msg: string; data: T }> {
    if (context.getType() === 'rpc') {
      return next.handle().pipe(
        map((data) => ({
          status: 200,
          msg: 'success',
          data: data ?? null,
        })),
      );
    }

    return next.handle();
  }
}
