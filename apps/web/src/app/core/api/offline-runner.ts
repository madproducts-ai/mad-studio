import { plan, type PlanOptions } from '@mad/planner';
import { GenerationEventSchema, type GenerationEvent } from '@mad/schema';

/**
 * Runs the planner in the browser when the API is unreachable, emitting the
 * same event shapes on the same pacing. The studio treats both sources
 * identically, so offline mode is a first-class experience rather than a
 * degraded one. Generated documents persist to localStorage per project.
 */
export class OfflineRunner {
  private cancelled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly prompt: string,
    private readonly options: PlanOptions,
    private readonly onEvent: (event: GenerationEvent) => void,
    private readonly onComplete: () => void,
  ) {}

  start(): void {
    const result = plan(this.prompt, this.options);
    const events = result.events;
    let index = 0;
    let seq = 0;
    const tick = () => {
      if (this.cancelled) return;
      const next = events[index];
      if (!next) {
        this.onComplete();
        return;
      }
      this.timer = setTimeout(() => {
        if (this.cancelled) return;
        const full = GenerationEventSchema.parse({ ...next.event, seq, at: new Date().toISOString() });
        seq += 1;
        index += 1;
        this.onEvent(full);
        tick();
      }, next.delayMs);
    };
    tick();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.timer) clearTimeout(this.timer);
    this.onEvent(GenerationEventSchema.parse({ type: 'status', status: 'cancelled', message: 'Generation cancelled.', seq: 100000, at: new Date().toISOString() }));
    this.onComplete();
  }
}
