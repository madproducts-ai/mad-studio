import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Deployment, Project } from '@mad/schema';
import { NotFoundError, StateError } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { REPOSITORY, type Repository } from '../../repositories/repository';
import { ProjectsService } from '../projects/projects.service';
import { SitePublisher } from './publisher';

/**
 * Deployment lifecycle: queued → building → live | failed. "Building" renders
 * the saved document version to a standalone static page and publishes it to
 * the fleet's web root; "live" means the bytes were read back from disk (and,
 * when a public base is configured, fetched over HTTP).
 */
@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger('Deployments');

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(ENV) private readonly env: Env,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(SitePublisher) private readonly publisher: SitePublisher,
  ) {}

  async create(workspaceId: string, projectId: string, target: Deployment['target']): Promise<Deployment> {
    const project = await this.projects.get(workspaceId, projectId);
    if (project.documentVersion === 0) throw new StateError('Nothing to deploy yet. Generate or save a document first.');
    const deployment = await this.repo.deployments.create(projectId, project.documentVersion, target);
    void this.runPipeline(deployment, project);
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

  private async runPipeline(deployment: Deployment, project: Project): Promise<void> {
    try {
      await this.repo.deployments.update(deployment.id, { status: 'building' });
      const record = (await this.repo.documents.get(project.id, deployment.documentVersion)) ?? (await this.repo.documents.latest(project.id));
      if (!record) throw new Error(`Document v${deployment.documentVersion} for project ${project.id} was not found.`);
      const studioUrl = this.env.CORS_ORIGINS[0] ? `${this.env.CORS_ORIGINS[0].replace(/\/+$/, '')}/studio/${project.id}` : null;
      const result = await this.publisher.publish({ deployment, project, document: record.document, studioUrl });
      await this.repo.deployments.update(deployment.id, { status: 'live', url: result.url });
      if (deployment.target === 'production') await this.repo.projects.update(deployment.projectId, { status: 'deployed' });
    } catch (error) {
      this.logger.error(`Deployment ${deployment.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.repo.deployments.update(deployment.id, { status: 'failed' }).catch(() => undefined);
    }
  }
}
