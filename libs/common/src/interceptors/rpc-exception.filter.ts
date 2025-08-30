import { Catch, ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

@Catch(RpcException)
export class GatewayRpcExceptionFilter implements ExceptionFilter {
  catch(exception: RpcException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let error = exception.getError();

    // Nếu service ném object { status, msg }
    if (typeof error === 'object' && error !== null) {
      return response.status((error as any).status ?? 400).json({
        status: (error as any).status ?? 400,
        msg: (error as any).msg ?? 'Rpc error',
        data: null,
      });
    }

    // Nếu service ném string
    return response.status(400).json({
      status: 400,
      msg: error as string,
      data: null,
    });
  }
}
