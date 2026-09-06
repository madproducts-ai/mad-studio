import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/request-id.middleware';
import { ENV, type Env } from './config/env';
import { SitePublisher } from './modules/deployments/publisher';

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
  // Sessions ride in an HttpOnly cookie, so responses must allow credentials and
  // the origin list must be explicit (never "*"). In development any loopback
  // origin is allowed so the web dev server can move ports freely.
  const devOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  app.enableCors({
    origin: env.NODE_ENV === 'development' ? [...env.CORS_ORIGINS, devOrigin] : env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Last-Event-ID', 'X-Request-Id', 'X-MAD-Client'],
    exposedHeaders: ['X-Request-Id'],
    credentials: true,
    maxAge: 600,
  });
  // Without a fleet web root the API serves deployed pages itself so the Deploy button works in development.
  const publisher = app.get(SitePublisher);
  if (publisher.servesLocally) {
    app.useStaticAssets(publisher.root, { prefix: '/exports/', index: 'index.html', maxAge: 0, etag: true });
  }
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);
  logger.log(`MAD Studio API listening on http://${env.HOST}:${env.PORT}/v1 (${env.NODE_ENV})`);
  logger.log(`Planner: ${env.ANTHROPIC_API_KEY ? `model-backed (${env.PLANNER_MODEL}, ${env.PLANNER_EFFORT} effort) with heuristic fallback` : 'heuristic (set ANTHROPIC_API_KEY to enable the model-backed planner)'}`);
  logger.log(`Deploy target: ${env.DEPLOY_EXPORT_ROOT ? `${env.DEPLOY_EXPORT_ROOT} → ${env.DEPLOY_PUBLIC_BASE ?? `http://${env.HOST}:${env.PORT}/exports`}` : 'local exports folder'}`);
};

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
