import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  BadGatewayException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Database errors that are the client's, not the server's (audit A14,
 * 2026-11-18): a row that two requests created at once, a row that was
 * deleted meanwhile. They used to answer 500. Prisma's own message names
 * tables and columns, so it never goes out.
 */
const PRISMA_CLIENT_ERRORS: Record<
  string,
  { status: number; error: string; message: string }
> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    error: 'DUPLICATE',
    message:
      'Dữ liệu này vừa được tạo hoặc đã tồn tại. Tải lại trang rồi thử lại.',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    error: 'RELATED_CHANGED',
    message:
      'Dữ liệu liên quan vừa thay đổi hoặc đã bị xoá. Tải lại trang rồi thử lại.',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    error: 'NOT_FOUND',
    message: 'Không tìm thấy dữ liệu. Có thể nó vừa bị xoá.',
  },
};

/** A letter only Vietnamese uses: the text was written for the user. */
const VIETNAMESE_LETTER =
  /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;

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
    const dbClientError =
      exception instanceof Prisma.PrismaClientKnownRequestError
        ? PRISMA_CLIENT_ERRORS[exception.code]
        : undefined;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : tooLarge
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : (dbClientError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const requestId = randomUUID();

    let message = 'Internal server error';
    let errorDetails: any = null;
    // The day's AI gradings ran out: which plan and how many, for the notice.
    let quota: { limit: number; planCode: string } | undefined;
    // A machine-readable code the client branches on (ACCOUNT_LINK_REQUIRED,
    // CONSENT_REQUIRED, ACCOUNT_PENDING_DELETION) and the two values the
    // pending-deletion notice needs. Nothing else of the exception goes out.
    let coded: Record<string, string | null> = {};

    if (exception instanceof HttpException) {
      const responseObj = exception.getResponse();
      if (typeof responseObj === 'object' && responseObj !== null) {
        message = (responseObj as any)['message'] || responseObj.toString();
        errorDetails = (responseObj as any)['error'] || null;
        const { limit, planCode } = responseObj as Record<string, unknown>;
        if (typeof limit === 'number' && typeof planCode === 'string')
          quota = { limit, planCode };
        const { code, scheduledAt, cancelToken } = responseObj as Record<
          string,
          unknown
        >;
        if (typeof code === 'string') {
          coded = { code };
          if (typeof scheduledAt === 'string' || scheduledAt === null)
            coded.scheduledAt = scheduledAt;
          if (typeof cancelToken === 'string') coded.cancelToken = cancelToken;
        }
      } else {
        message = responseObj.toString();
      }
    } else if (tooLarge) {
      message = 'Dữ liệu gửi lên quá lớn. Vui lòng dùng tệp hoặc ảnh nhỏ hơn.';
      errorDetails = 'PAYLOAD_TOO_LARGE';
    } else if (dbClientError) {
      message = dbClientError.message;
      errorDetails = dbClientError.error;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // A 502 thrown on purpose names what failed (the admin AI drafts: "Không
    // thể soạn bài nghe lúc này"), in a fixed Vietnamese sentence; it is kept.
    // Every other 5xx text is replaced, so no internal detail goes out.
    const namedGatewayFailure =
      exception instanceof BadGatewayException &&
      typeof message === 'string' &&
      VIETNAMESE_LETTER.test(message);
    if (status >= 500 && namedGatewayFailure) {
      errorDetails = 'BAD_GATEWAY';
    } else if (status >= 500) {
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
      ...(quota ? { quota } : {}),
      ...(status < 500 ? coded : {}),
    });
  }
}
