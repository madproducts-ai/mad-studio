import { Controller, Get, Inject } from '@nestjs/common';
import { REPOSITORY, type Repository } from '../../repositories/repository';
import { ENV, type Env } from '../../config/env';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async health(): Promise<{ status: 'ok' | 'degraded'; storage: string; storageReachable: boolean; uptimeMs: number; env: string; version: string }> {
    const reachable = await this.repo.ping();
    return {
      status: reachable ? 'ok' : 'degraded',
      storage: this.repo.kind,
      storageReachable: reachable,
      uptimeMs: Date.now() - this.startedAt,
      env: this.env.NODE_ENV,
      version: '0.1.0',
    };
  }
}
