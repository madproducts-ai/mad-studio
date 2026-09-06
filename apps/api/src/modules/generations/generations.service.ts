import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Observable, ReplaySubject } from 'rxjs';
import { plan, type TimedEvent } from '@mad/planner';
import { GenerationEventSchema, type CreateGenerationRequest, type GenerationEvent, type GenerationSummary, type GenerationStatus } from '@mad/schema';
import { NotFoundError, StateError } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { REPOSITORY, type Repository } from '../../repositories/repository';
import { ProjectsService } from '../projects/projects.service';

interface LiveGeneration {
  subject: ReplaySubject<GenerationEvent>;
  abort: AbortController;
  seq: number;
  pendingPersist: GenerationEvent[];
  persistTimer: NodeJS.Timeout | null;
  finished: Promise<void>;
  resolveFinished: () => void;
}

/**
 * Runs generations. Each generation is planned synchronously (pure), then
 * replayed on a timer so the client sees the interface assemble. Events are
 * fanned out to live subscribers through a ReplaySubject and persisted in
 * batches; a reconnecting client with Last-Event-ID is served the persisted
 * backlog first and then joins the live stream without gaps or duplicates.
 */
@Injectable()
export class GenerationsService implements OnModuleDestroy {
  private readonly logger = new Logger('Generations');
  private readonly live = new Map<string, LiveGeneration>();

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Inject(ENV) private readonly env: Env,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  async create(workspaceId: string, input: CreateGenerationRequest): Promise<GenerationSummary> {
    let projectId = input.projectId ?? null;
    if (projectId) {
      await this.projects.get(workspaceId, projectId);
    } else {
      const preview = plan(input.prompt, { designSystem: input.designSystem, pace: 0 });
      const project = await this.projects.create(workspaceId, { name: preview.analysis.appName, description: input.prompt.slice(0, 400), designSystem: input.designSystem });
      projectId = project.id;
    }

    const summary = await this.repo.generations.create({
      id: randomUUID(),
      projectId,
      prompt: input.prompt,
      designSystem: input.designSystem,
      seed: input.seed ?? null,
    });
    await this.repo.projects.update(projectId, { status: 'building', lastPrompt: input.prompt });

    const options = { designSystem: input.designSystem, pace: this.env.GENERATION_PACE, ...(input.seed !== undefined ? { seed: input.seed } : {}) };
    const result = plan(input.prompt, options);
    void this.run(summary.id, projectId, result.events, result.document);
    return summary;
  }

  async get(id: string): Promise<GenerationSummary> {
    const g = await this.repo.generations.findById(id);
    if (!g) throw new NotFoundError('Generation', id);
    return g;
  }

  listForProject(projectId: string, limit: number): Promise<GenerationSummary[]> {
    return this.repo.generations.listForProject(projectId, limit);
  }

  async cancel(id: string): Promise<GenerationSummary> {
    const g = await this.get(id);
    const live = this.live.get(id);
    if (!live) throw new StateError(`Generation is already ${g.status}.`, { status: g.status });
    live.abort.abort();
    await live.finished;
    return this.get(id);
  }

  /** Persisted backlog after `afterSeq`, then live events. Completes when the generation finishes. */
  stream(id: string, afterSeq: number): Observable<GenerationEvent> {
    return new Observable<GenerationEvent>((subscriber) => {
      let cancelled = false;
      let liveSub: { unsubscribe(): void } | null = null;
      (async () => {
        const g = await this.repo.generations.findById(id);
        if (!g) {
          subscriber.error(new NotFoundError('Generation', id));
          return;
        }
        const live = this.live.get(id);
        // Flush anything buffered but not yet persisted so backlog + live is gap-free.
        if (live) await this.flush(id, live);
        const backlog = await this.repo.generations.eventsSince(id, afterSeq);
        let lastSeq = afterSeq;
        for (const e of backlog) {
          if (cancelled) return;
          subscriber.next(e);
          lastSeq = Math.max(lastSeq, e.seq);
        }
        if (!live) {
          subscriber.complete();
          return;
        }
        liveSub = live.subject.subscribe({
          next: (e) => {
            if (e.seq > lastSeq) {
              lastSeq = e.seq;
              subscriber.next(e);
            }
          },
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      })().catch((err) => subscriber.error(err));
      return () => {
        cancelled = true;
        liveSub?.unsubscribe();
      };
    });
  }

  private async run(id: string, projectId: string, timeline: TimedEvent[], document: Parameters<Repository['documents']['append']>[2]): Promise<void> {
    let resolveFinished: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const live: LiveGeneration = { subject: new ReplaySubject<GenerationEvent>(Number.POSITIVE_INFINITY), abort: new AbortController(), seq: 0, pendingPersist: [], persistTimer: null, finished, resolveFinished };
    this.live.set(id, live);
    const startedAt = Date.now();
    let lastStatus: GenerationStatus = 'queued';
    let nodeCount: number | null = null;

    try {
      for (const { delayMs, event } of timeline) {
        if (live.abort.signal.aborted) throw new CancelledError();
        if (delayMs > 0) await this.sleep(delayMs, live.abort.signal);
        const full = GenerationEventSchema.parse({ ...event, seq: live.seq, at: new Date().toISOString() });
        live.seq += 1;
        if (full.type === 'status') {
          lastStatus = full.status;
          await this.repo.generations.setStatus(id, full.status);
        }
        if (full.type === 'done') nodeCount = full.nodeCount;
        live.subject.next(full);
        this.queuePersist(id, live, full);
      }
      await this.flush(id, live);
      const project = await this.repo.projects.findById(projectId);
      if (project) {
        await this.repo.documents.append(projectId, project.documentVersion, { ...document, updatedAt: new Date().toISOString() }, 'ai', id);
      }
      await this.repo.generations.complete(id, { status: 'complete', durationMs: Date.now() - startedAt, nodeCount, error: null });
      live.subject.complete();
    } catch (error) {
      const cancelled = error instanceof CancelledError;
      const message = cancelled ? 'Generation cancelled by user.' : error instanceof Error ? error.message : String(error);
      if (!cancelled) this.logger.error(`Generation ${id} failed after status ${lastStatus}: ${message}`);
      const terminal = GenerationEventSchema.parse({
        type: cancelled ? 'status' : 'error',
        ...(cancelled ? { status: 'cancelled', message } : { code: 'generation_failed', message, retryable: true }),
        seq: live.seq,
        at: new Date().toISOString(),
      });
      live.seq += 1;
      live.subject.next(terminal);
      this.queuePersist(id, live, terminal);
      await this.flush(id, live).catch((e) => this.logger.error(`Failed to persist terminal event for ${id}: ${String(e)}`));
      await this.repo.generations
        .complete(id, { status: cancelled ? 'cancelled' : 'failed', durationMs: Date.now() - startedAt, nodeCount, error: message })
        .catch((e) => this.logger.error(`Failed to mark generation ${id}: ${String(e)}`));
      await this.repo.projects.update(projectId, { status: 'draft' }).catch(() => undefined);
      live.subject.complete();
    } finally {
      this.live.delete(id);
      live.resolveFinished();
    }
  }

  private queuePersist(id: string, live: LiveGeneration, event: GenerationEvent): void {
    live.pendingPersist.push(event);
    if (live.persistTimer) return;
    live.persistTimer = setTimeout(() => {
      live.persistTimer = null;
      void this.flush(id, live);
    }, 250);
  }

  private async flush(id: string, live: LiveGeneration): Promise<void> {
    if (live.persistTimer) {
      clearTimeout(live.persistTimer);
      live.persistTimer = null;
    }
    if (live.pendingPersist.length === 0) return;
    const batch = live.pendingPersist.splice(0, live.pendingPersist.length);
    try {
      await this.repo.generations.appendEvents(id, batch);
    } catch (error) {
      // Put them back so a later flush retries; the live stream is unaffected.
      live.pendingPersist.unshift(...batch);
      this.logger.warn(`Deferred persisting ${batch.length} events for ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new CancelledError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  onModuleDestroy(): void {
    for (const live of this.live.values()) live.abort.abort();
  }
}

class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}
