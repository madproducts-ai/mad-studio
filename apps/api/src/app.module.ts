import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { LoggingInterceptor } from './common/logging.interceptor';
import { RepositoryModule } from './repositories/repository.module';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { PrincipalGuard } from './auth/current-user';
import { RateLimiter } from './auth/rate-limit';
import { HealthController } from './modules/health/health.controller';
import { ProjectsController } from './modules/projects/projects.controller';
import { ProjectsService } from './modules/projects/projects.service';
import { GenerationsController } from './modules/generations/generations.controller';
import { GenerationsService } from './modules/generations/generations.service';
import { ModelPlanner } from './modules/generations/model-planner';
import { IntegrationsController } from './modules/integrations/integrations.controller';
import { PresetsController } from './modules/presets/presets.controller';
import { DeploymentsController } from './modules/deployments/deployments.controller';
import { DeploymentsService } from './modules/deployments/deployments.service';
import { SitePublisher } from './modules/deployments/publisher';

@Module({
  imports: [ConfigModule, RepositoryModule],
  controllers: [HealthController, AuthController, ProjectsController, GenerationsController, IntegrationsController, PresetsController, DeploymentsController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    RateLimiter,
    AuthService,
    PrincipalGuard,
    ProjectsService,
    ModelPlanner,
    GenerationsService,
    SitePublisher,
    DeploymentsService,
  ],
})
export class AppModule {}
