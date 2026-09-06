import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Deployment } from '@mad/schema';
import { NotFoundError, StateError } from '../../common/errors';
import { REPOSITORY, type Repository } from '../../repositories/repository';
import { ProjectsService } from '../projects/projects.service';

/**
 * Deployment lifecycle: queued → building → live. The build itself is a
 * simulated pipeline (bundle, upload, warm edge) with realistic timing so the
 * UI's optimistic states are exercised end to end; swapping in a real build
 * runner only changes `runPipeline`.
 */
@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger('Deployments');

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  async create(workspaceId: string, projectId: string, target: Deployment['target']): Promise<Deployment> {
    const project = await this.projects.get(workspaceId, projectId);
    if (project.documentVersion === 0) throw new StateError('Nothing to deploy yet. Generate or save a document first.');
    const deployment = await this.repo.deployments.create(projectId, project.documentVersion, target);
    void this.runPipeline(deployment, project.slug);
    return deployment;
  }

  async get(workspaceId: string, projectId: string, id: string): Promise<Deployment> {
    await this.projects.get(workspaceId, projectId);
    const d = await this.repo.deployments.findById(id);
    if (!d || d.projectId !== projectId) throw new NotFoundError('Deployment', id);
    return d;
  }

  async list(workspaceId: string, projectId: string, limit: number): Promise<Deployment[]> {
    await this.projects.get(workspaceId, projectId);
    return this.repo.deployments.listForProject(projectId, limit);
  }

  private async runPipeline(deployment: Deployment, slug: string): Promise<void> {
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    try {
      await wait(600);
      await this.repo.deployments.update(deployment.id, { status: 'building' });
      await wait(2400 + Math.random() * 1600);
      const host = deployment.target === 'production' ? `${slug}.madproducts.app` : `${slug}-${deployment.id.slice(0, 8)}.preview.madproducts.app`;
      await this.repo.deployments.update(deployment.id, { status: 'live', url: `https://${host}` });
      if (deployment.target === 'production') {
        await this.repo.projects.update(deployment.projectId, { status: 'deployed' });
      }
    } catch (error) {
      this.logger.error(`Deployment ${deployment.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.repo.deployments.update(deployment.id, { status: 'failed' }).catch(() => undefined);
    }
  }
}
