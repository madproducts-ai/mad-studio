import { type CallHandler, type ExecutionContext, HttpException, Injectable, Logger, type NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Access');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      tap({
        complete: () => this.log(req, res.statusCode),
        // The exception filter has not run yet, so the response still carries its
        // default status; take the real one from the error instead.
        error: (error: unknown) => this.log(req, error instanceof HttpException ? error.getStatus() : 500),
      }),
    );
  }

  private log(req: Request, status: number): void {
    const ms = Math.round(performance.now() - (req.startedAt ?? performance.now()));
    this.logger.log(`${req.method} ${req.originalUrl} → ${status} ${ms}ms [${req.requestId}]`);
  }
}
