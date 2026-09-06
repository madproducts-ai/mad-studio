import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CreateProjectRequestSchema, SaveDocumentRequestSchema, type CreateProjectRequest, type SaveDocumentRequest } from '@mad/schema';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentPrincipal, PrincipalGuard, type Principal } from '../../auth/current-user';
import { ProjectsService } from './projects.service';

const IdSchema = z.string().uuid();
const ListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(24), cursor: z.string().min(1).optional() });
const RenameSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(400).nullable().default(null) }).strict();
const HistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

@Controller('projects')
@UseGuards(PrincipalGuard)
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal, @Query(zodBody(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>) {
    return this.projects.list(principal.workspace.id, query.limit, query.cursor ?? null);
  }

  @Post()
  create(@CurrentPrincipal() principal: Principal, @Body(zodBody(CreateProjectRequestSchema)) body: CreateProjectRequest) {
    return this.projects.create(principal.workspace.id, body);
  }

  @Get(':id')
  get(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string) {
    return this.projects.get(principal.workspace.id, id);
  }

  @Patch(':id')
  rename(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string, @Body(zodBody(RenameSchema)) body: z.infer<typeof RenameSchema>) {
    return this.projects.rename(principal.workspace.id, id, body.name, body.description);
  }

  @Post(':id/archive')
  archive(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string) {
    return this.projects.archive(principal.workspace.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string): Promise<void> {
    await this.projects.remove(principal.workspace.id, id);
  }

  @Get(':id/document')
  document(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string) {
    return this.projects.latestDocument(principal.workspace.id, id);
  }

  @Put(':id/document')
  saveDocument(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string, @Body(zodBody(SaveDocumentRequestSchema)) body: SaveDocumentRequest) {
    return this.projects.saveDocument(principal.workspace.id, id, body);
  }

  @Get(':id/document/history')
  history(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string, @Query(zodBody(HistoryQuerySchema)) query: z.infer<typeof HistoryQuerySchema>) {
    return this.projects.documentHistory(principal.workspace.id, id, query.limit);
  }
}
