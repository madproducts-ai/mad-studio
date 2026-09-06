import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentPrincipal, PrincipalGuard, type Principal } from '../../auth/current-user';
import { DeploymentsService } from './deployments.service';

const IdSchema = z.string().uuid();
const CreateSchema = z.object({ target: z.enum(['preview', 'production']).default('preview') }).strict();
const ListSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

@Controller('projects/:id/deployments')
@UseGuards(PrincipalGuard)
export class DeploymentsController {
  constructor(@Inject(DeploymentsService) private readonly deployments: DeploymentsService) {}

  @Post()
  create(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string, @Body(zodBody(CreateSchema)) body: z.infer<typeof CreateSchema>) {
    return this.deployments.create(principal.workspace.id, id, body.target);
  }

  @Get()
  list(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string, @Query(zodBody(ListSchema)) query: z.infer<typeof ListSchema>) {
    return this.deployments.list(principal.workspace.id, id, query.limit);
  }

  @Get(':deploymentId')
  get(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string, @Param('deploymentId', zodBody(IdSchema)) deploymentId: string) {
    return this.deployments.get(principal.workspace.id, id, deploymentId);
  }
}
