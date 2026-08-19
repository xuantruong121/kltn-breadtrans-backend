import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

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
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Log detailed error for debugging
    const logDetails = `[${request.method}] ${request.url} - Status: ${status} - Error: ${
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
      message,
      error: errorDetails,
    });
  }
}
