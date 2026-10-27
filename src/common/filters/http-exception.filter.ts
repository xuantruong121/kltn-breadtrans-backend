import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // body-parser rejects oversized bodies with a plain error carrying
    // `type: 'entity.too.large'`; it is a client error (413), not a server fault.
    const tooLarge =
      (exception as { type?: string } | null)?.type === 'entity.too.large';
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : tooLarge
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = randomUUID();

    let message = 'Internal server error';
    let errorDetails: any = null;

    if (exception instanceof HttpException) {
      const responseObj = exception.getResponse();
      if (typeof responseObj === 'object' && responseObj !== null) {
        message = (responseObj as any)['message'] || responseObj.toString();
        errorDetails = (responseObj as any)['error'] || null;
      } else {
        message = responseObj.toString();
      }
    } else if (tooLarge) {
      message = 'Dữ liệu gửi lên quá lớn. Vui lòng dùng tệp hoặc ảnh nhỏ hơn.';
      errorDetails = 'PAYLOAD_TOO_LARGE';
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      message = 'Máy chủ gặp sự cố tạm thời. Vui lòng thử lại sau ít phút.';
      errorDetails = 'INTERNAL_ERROR';
    }

    // Log detailed error for debugging
    const logDetails = `[${request.method}] ${request.url} - Status: ${status} - Request: ${requestId} - Error: ${
      Array.isArray(message) ? message.join(', ') : message
    }`;

    if (status >= 500) {
      this.logger.error(logDetails, (exception as Error)?.stack || '');
    } else {
      this.logger.warn(logDetails);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
      message,
      error: errorDetails,
    });
  }
}
