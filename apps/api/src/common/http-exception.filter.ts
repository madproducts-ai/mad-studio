import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Inject, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '@mad/schema';
import { AppError } from './errors';
import { ENV, type Env } from '../config/env';

/**
 * Single choke point for every error leaving the API. Output always matches
 * `ApiErrorSchema` from @mad/schema, so the web client has one shape to parse.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  constructor(@Inject(ENV) private readonly env: Env) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = req.requestId ?? 'unknown';

    let body: ApiError;

    if (exception instanceof AppError) {
      body = {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        requestId,
        ...(exception.details !== undefined ? { details: exception.details } : {}),
      };
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : ((response as { message?: string | string[] }).message ?? exception.message);
      body = {
        statusCode: status,
        code: status === 404 ? 'route_not_found' : status === 400 ? 'bad_request' : 'http_error',
        message: Array.isArray(message) ? message.join('; ') : message,
        requestId,
      };
    } else {
      this.logger.error(`Unhandled error on ${req.method} ${req.url} [${requestId}]`, exception instanceof Error ? exception.stack : String(exception));
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'internal_error',
        message: this.env.NODE_ENV === 'production' ? 'Something went wrong on our side.' : exception instanceof Error ? exception.message : String(exception),
        requestId,
      };
    }

    if (res.headersSent) {
      // Streaming responses (SSE) may already have flushed headers; end quietly.
      res.end();
      return;
    }
    res.status(body.statusCode).json(body);
  }
}
