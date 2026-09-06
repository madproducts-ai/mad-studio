import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/request-id.middleware';
import { ENV, type Env } from './config/env';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('v1');
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // In development any loopback origin is allowed so the web dev server can move ports freely.
  const devOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  app.enableCors({
    origin: env.NODE_ENV === 'development' ? [...env.CORS_ORIGINS, devOrigin] : env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Last-Event-ID', 'X-Request-Id', 'X-Mad-User-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: 600,
  });
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);
  logger.log(`MAD Studio API listening on http://${env.HOST}:${env.PORT}/v1 (${env.NODE_ENV})`);
};

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
