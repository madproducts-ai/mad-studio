import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Integration, ProjectIntegration } from '@mad/schema';
import { NotFoundError } from '../../common/errors';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentPrincipal, PrincipalGuard, type Principal } from '../../auth/current-user';
import { REPOSITORY, type Repository } from '../../repositories/repository';
import { ProjectsService } from '../projects/projects.service';

const IdSchema = z.string().uuid();
const SlugSchema = z.string().regex(/^[a-z0-9-]{2,40}$/);
const AttachSchema = z.object({ slug: SlugSchema }).strict();
const StatusSchema = z.object({ status: z.enum(['pending', 'connected', 'error']), config: z.record(z.string(), z.string()).default({}) }).strict();

@Controller()
@UseGuards(PrincipalGuard)
export class IntegrationsController {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  @Get('integrations')
  catalog(): Promise<Integration[]> {
    return this.repo.integrations.catalog();
  }

  @Get('integrations/:slug')
  async one(@Param('slug', zodBody(SlugSchema)) slug: string): Promise<Integration> {
    const item = await this.repo.integrations.findBySlug(slug);
    if (!item) throw new NotFoundError('Integration', slug);
    return item;
  }

  @Get('projects/:id/integrations')
  async listForProject(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string): Promise<ProjectIntegration[]> {
    await this.projects.get(principal.workspace.id, id);
    return this.repo.integrations.listForProject(id);
  }

  @Post('projects/:id/integrations')
  async attach(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string, @Body(zodBody(AttachSchema)) body: z.infer<typeof AttachSchema>): Promise<ProjectIntegration> {
    await this.projects.get(principal.workspace.id, id);
    return this.repo.integrations.attach(id, body.slug);
  }

  @Patch('projects/:id/integrations/:integrationId')
  async setStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('id', zodBody(IdSchema)) id: string,
    @Param('integrationId', zodBody(IdSchema)) integrationId: string,
    @Body(zodBody(StatusSchema)) body: z.infer<typeof StatusSchema>,
  ): Promise<ProjectIntegration> {
    await this.projects.get(principal.workspace.id, id);
    return this.repo.integrations.setStatus(integrationId, body.status, body.config);
  }

  @Delete('projects/:id/integrations/:integrationId')
  @HttpCode(204)
  async detach(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string, @Param('integrationId', zodBody(IdSchema)) integrationId: string): Promise<void> {
    await this.projects.get(principal.workspace.id, id);
    await this.repo.integrations.detach(integrationId);
  }
}
