import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';
import { CreateGenerationRequestSchema, type CreateGenerationRequest } from '@mad/schema';
import { zodBody } from '../../common/zod-validation.pipe';
import { CurrentPrincipal, PrincipalGuard, type Principal } from '../../auth/current-user';
import { GenerationsService } from './generations.service';

const IdSchema = z.string().uuid();
const ListQuerySchema = z.object({ projectId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(50).default(10) });
const AfterQuerySchema = z.object({ after: z.coerce.number().int().min(-1).default(-1) });

@Controller('generations')
@UseGuards(PrincipalGuard)
export class GenerationsController {
  constructor(@Inject(GenerationsService) private readonly generations: GenerationsService) {}

  @Post()
  create(@CurrentPrincipal() principal: Principal, @Body(zodBody(CreateGenerationRequestSchema)) body: CreateGenerationRequest) {
    return this.generations.create(principal.workspace.id, body);
  }

  @Get()
  list(@CurrentPrincipal() principal: Principal, @Query(zodBody(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>) {
    return this.generations.listForProject(principal.workspace.id, query.projectId, query.limit);
  }

  @Get(':id')
  get(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string) {
    return this.generations.get(principal.workspace.id, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentPrincipal() principal: Principal, @Param('id', zodBody(IdSchema)) id: string) {
    return this.generations.cancel(principal.workspace.id, id);
  }

  /**
   * Server-Sent Events. Resume with either `Last-Event-ID` (browsers send it
   * automatically on reconnect) or `?after=<seq>`. Event `id` is the seq.
   */
  @Sse(':id/events')
  events(
    @CurrentPrincipal() principal: Principal,
    @Param('id', zodBody(IdSchema)) id: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Query(zodBody(AfterQuerySchema)) query: z.infer<typeof AfterQuerySchema>,
  ): Observable<MessageEvent> {
    const fromHeader = lastEventId !== undefined ? Number.parseInt(lastEventId, 10) : Number.NaN;
    const after = Number.isFinite(fromHeader) ? fromHeader : query.after;
    return this.generations.stream(principal.workspace.id, id, after).pipe(
      map((event): MessageEvent => ({ id: String(event.seq), type: event.type, data: event, retry: 1500 })),
    );
  }
}
