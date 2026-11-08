import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody } from '@tutor/shared';

/** One error shape for the whole API: { statusCode, code, message }. Internals never leak. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let body: ApiErrorBody;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
      body = {
        statusCode: status,
        code: typeof obj.code === 'string' ? obj.code : defaultCode(status),
        message:
          typeof obj.message === 'string'
            ? obj.message
            : Array.isArray(obj.message)
              ? obj.message.join('; ')
              : exception.message,
      };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
      };
    }
    res.status(body.statusCode).json(body);
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'ERROR';
  }
}
