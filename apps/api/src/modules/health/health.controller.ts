import { Controller, Get, Inject } from '@nestjs/common';
import { REPOSITORY, type Repository } from '../../repositories/repository';
import { ENV, type Env } from '../../config/env';
import { ModelPlanner } from '../generations/model-planner';

export interface HealthReport {
  status: 'ok' | 'degraded';
  storage: string;
  storageReachable: boolean;
  uptimeMs: number;
  env: string;
  version: string;
  /** Which planner answers prompts; lets the studio label AI-planned builds honestly. */
  planner: { mode: 'model' | 'heuristic'; model: string | null };
  /** Whether the Deploy button publishes to a real host. */
  deploy: { mode: 'fleet' | 'local'; publicBase: string | null };
}

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(ENV) private readonly env: Env,
    @Inject(ModelPlanner) private readonly planner: ModelPlanner,
  ) {}

  @Get()
  async health(): Promise<HealthReport> {
    const reachable = await this.repo.ping();
    return {
      status: reachable ? 'ok' : 'degraded',
      storage: this.repo.kind,
      storageReachable: reachable,
      uptimeMs: Date.now() - this.startedAt,
      env: this.env.NODE_ENV,
      version: '0.2.0',
      planner: { mode: this.planner.enabled ? 'model' : 'heuristic', model: this.planner.enabled ? this.planner.model : null },
      deploy: { mode: this.env.DEPLOY_PUBLIC_BASE ? 'fleet' : 'local', publicBase: this.env.DEPLOY_PUBLIC_BASE ?? null },
    };
  }
}
