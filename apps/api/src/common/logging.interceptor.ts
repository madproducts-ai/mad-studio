import { type CallHandler, type ExecutionContext, Injectable, Logger, type NestInterceptor } from '@nestjs/common';
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
        complete: () => this.log(req, res),
        error: () => this.log(req, res),
      }),
    );
  }

  private log(req: Request, res: Response): void {
    const ms = Math.round(performance.now() - (req.startedAt ?? performance.now()));
    this.logger.log(`${req.method} ${req.originalUrl} → ${res.statusCode} ${ms}ms [${req.requestId}]`);
  }
}
