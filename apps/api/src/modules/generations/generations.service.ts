import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Observable, ReplaySubject } from 'rxjs';
import { plan, planFromSpec, type TimedEvent } from '@mad/planner';
import { GenerationEventSchema, type CreateGenerationRequest, type GenerationEvent, type GenerationSummary, type GenerationStatus, type MadDocument } from '@mad/schema';
import { NotFoundError, StateError } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { REPOSITORY, type Repository } from '../../repositories/repository';
import { ProjectsService } from '../projects/projects.service';
import { ModelPlanner, PlannerUnavailableError } from './model-planner';

interface LiveGeneration {
  subject: ReplaySubject<GenerationEvent>;
  abort: AbortController;
  seq: number;
  pendingPersist: GenerationEvent[];
  persistTimer: NodeJS.Timeout | null;
  finished: Promise<void>;
  resolveFinished: () => void;
}

/** What a planning source hands back once its timeline is exhausted. */
interface PlanOutcome {
  document: MadDocument;
  planner: 'model' | 'heuristic';
  /** Set when the model chose a better name/description than the heuristic preview. */
  rename: { name: string; description: string } | null;
}

/** Keep a full generation (planning + reveal) inside the product promise. */
const TOTAL_BUDGET_MS = 55_000;

/**
 * Runs generations. Planning produces a timed event stream (from the model-
 * backed planner when configured, otherwise from the deterministic one) that
 * is replayed on a timer so the client sees the interface assemble. Events are
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
    @Inject(ModelPlanner) private readonly modelPlanner: ModelPlanner,
  ) {}

  async create(workspaceId: string, input: CreateGenerationRequest): Promise<GenerationSummary> {
    // The heuristic pass is instant and always available: it names the project
    // up front and is the fallback if the model is slow or unavailable.
    const heuristic = plan(input.prompt, { designSystem: input.designSystem, pace: this.env.GENERATION_PACE, skipPlanning: true, ...(input.seed !== undefined ? { seed: input.seed } : {}) });
    let projectId = input.projectId ?? null;
    let createdProject = false;
    if (projectId) {
      await this.projects.get(workspaceId, projectId);
    } else {
      const project = await this.projects.create(workspaceId, { name: heuristic.analysis.appName, description: input.prompt.slice(0, 400), designSystem: input.designSystem });
      projectId = project.id;
      createdProject = true;
    }

    const summary = await this.repo.generations.create({
      id: randomUUID(),
      projectId,
      prompt: input.prompt,
      designSystem: input.designSystem,
      seed: input.seed ?? null,
    });
    await this.repo.projects.update(projectId, { status: 'building', lastPrompt: input.prompt });

    const abort = new AbortController();
    const source = this.timeline(input, heuristic, abort.signal, createdProject);
    void this.run(summary.id, projectId, abort, source);
    return summary;
  }

  async get(workspaceId: string, id: string): Promise<GenerationSummary> {
    const g = await this.repo.generations.findById(id);
    if (!g) throw new NotFoundError('Generation', id);
    // Ownership is transitive through the project; a foreign id reads as not found.
    await this.projects.get(workspaceId, g.projectId);
    return g;
  }

  async listForProject(workspaceId: string, projectId: string, limit: number): Promise<GenerationSummary[]> {
    await this.projects.get(workspaceId, projectId);
    return this.repo.generations.listForProject(projectId, limit);
  }

  async cancel(workspaceId: string, id: string): Promise<GenerationSummary> {
    const g = await this.get(workspaceId, id);
    const live = this.live.get(id);
    if (!live) throw new StateError(`Generation is already ${g.status}.`, { status: g.status });
    live.abort.abort();
    await live.finished;
    return this.get(workspaceId, id);
  }

  /** Persisted backlog after `afterSeq`, then live events. Completes when the generation finishes. */
  stream(workspaceId: string, id: string, afterSeq: number): Observable<GenerationEvent> {
    return new Observable<GenerationEvent>((subscriber) => {
      let cancelled = false;
      let liveSub: { unsubscribe(): void } | null = null;
      (async () => {
        await this.get(workspaceId, id);
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

  /**
   * The planning source. Emits the early status immediately so the client sees
   * progress while the model thinks, then yields the composed timeline. Falls
   * back to the deterministic plan on any model failure, saying so in the log.
   */
  private async *timeline(input: CreateGenerationRequest, heuristic: ReturnType<typeof plan>, signal: AbortSignal, createdProject: boolean): AsyncGenerator<TimedEvent, PlanOutcome> {
    yield { delayMs: 0, event: { type: 'status', status: 'planning', message: 'Reading the brief' } };
    if (!this.modelPlanner.enabled) {
      yield* heuristic.events;
      return { document: heuristic.document, planner: 'heuristic', rename: null };
    }

    yield { delayMs: 0, event: { type: 'log', level: 'info', message: `Asking ${this.modelPlanner.model} for an application plan` } };
    try {
      const draft = await this.modelPlanner.draft({ prompt: input.prompt, designSystem: input.designSystem, signal });
      const options = { designSystem: input.designSystem, tokens: draft.usage, leadTimeMs: draft.elapsedMs, model: draft.model, ...(input.seed !== undefined ? { seed: input.seed } : {}) };
      // Fit the reveal into what is left of the budget after the model's think time.
      const probe = planFromSpec(draft.spec, { ...options, pace: 1 });
      const revealMs = Math.max(1, probe.durationMs - draft.elapsedMs);
      const scale = Math.min(1, Math.max(0.25, (TOTAL_BUDGET_MS - draft.elapsedMs) / revealMs));
      const composed = planFromSpec(draft.spec, { ...options, pace: this.env.GENERATION_PACE * scale });
      yield* composed.events;
      return {
        document: composed.document,
        planner: 'model',
        rename: createdProject ? { name: draft.spec.appName.trim().slice(0, 80), description: draft.spec.summary.trim().slice(0, 400) } : null,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      const reason = error instanceof PlannerUnavailableError ? error.reason : error instanceof Error ? error.message : String(error);
      this.logger.warn(`Model planner unavailable (${reason}); using the deterministic planner.`);
      yield { delayMs: 0, event: { type: 'log', level: 'warn', message: `Model planner unavailable (${reason}). Using the deterministic planner instead.` } };
      yield* heuristic.events;
      return { document: heuristic.document, planner: 'heuristic', rename: null };
    }
  }

  private async run(id: string, projectId: string, abort: AbortController, source: AsyncGenerator<TimedEvent, PlanOutcome>): Promise<void> {
    let resolveFinished: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const live: LiveGeneration = { subject: new ReplaySubject<GenerationEvent>(Number.POSITIVE_INFINITY), abort, seq: 0, pendingPersist: [], persistTimer: null, finished, resolveFinished };
    this.live.set(id, live);
    const startedAt = Date.now();
    let lastStatus: GenerationStatus = 'queued';
    let nodeCount: number | null = null;

    const emit = async (event: TimedEvent['event']): Promise<void> => {
      const full = GenerationEventSchema.parse({ ...event, seq: live.seq, at: new Date().toISOString() });
      live.seq += 1;
      if (full.type === 'status') {
        lastStatus = full.status;
        await this.repo.generations.setStatus(id, full.status);
      }
      if (full.type === 'done') nodeCount = full.nodeCount;
      live.subject.next(full);
      this.queuePersist(id, live, full);
    };

    try {
      // "Complete" must mean the document is durable: the closing events are held
      // back until the document is written, so a client that reacts to `done`
      // (or polls the generation's status) can always read the saved document.
      const closing: TimedEvent['event'][] = [];
      let outcome: PlanOutcome | null = null;
      while (outcome === null) {
        if (abort.signal.aborted) throw new CancelledError();
        const next = await source.next();
        if (next.done) {
          outcome = next.value;
          break;
        }
        const { delayMs, event } = next.value;
        if (delayMs > 0) await this.sleep(delayMs, abort.signal);
        if (abort.signal.aborted) throw new CancelledError();
        if (event.type === 'done' || (event.type === 'status' && event.status === 'complete')) {
          closing.push(event);
          continue;
        }
        await emit(event);
      }
      await this.flush(id, live);
      const project = await this.repo.projects.findById(projectId);
      if (project) {
        await this.repo.documents.append(projectId, project.documentVersion, { ...outcome.document, updatedAt: new Date().toISOString() }, 'ai', id);
        if (outcome.rename) await this.projects.adoptPlannedIdentity(projectId, outcome.rename.name, outcome.rename.description);
      }
      for (const event of closing) await emit(event);
      await this.flush(id, live);
      await this.repo.generations.complete(id, { status: 'complete', durationMs: Date.now() - startedAt, nodeCount, error: null });
      this.logger.log(`Generation ${id} complete via ${outcome.planner} planner in ${Date.now() - startedAt}ms (${nodeCount ?? 0} nodes)`);
      live.subject.complete();
    } catch (error) {
      const cancelled = error instanceof CancelledError || abort.signal.aborted;
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
      await source.return(undefined as never).catch(() => undefined);
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
      if (signal.aborted) {
        reject(new CancelledError());
        return;
      }
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
