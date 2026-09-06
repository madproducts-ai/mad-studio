import { GenerationEventSchema, type GenerationEvent } from '@mad/schema';

export interface StreamHandlers {
  onEvent: (event: GenerationEvent) => void;
  onOpen?: () => void;
  onReconnect?: (attempt: number) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
}

/**
 * SSE client for a generation. Wraps EventSource with explicit resume: the
 * browser sends Last-Event-ID automatically, and we also track the last seq so
 * a manual reconnect (after the browser gives up) resumes exactly once from
 * the right place. Duplicate or out-of-order events are dropped.
 */
export class GenerationStream {
  private source: EventSource | null = null;
  private lastSeq = -1;
  private attempts = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly urlFor: (after: number) => string,
    private readonly handlers: StreamHandlers,
    private readonly maxAttempts = 6,
  ) {}

  open(): void {
    if (this.closed) return;
    this.source?.close();
    const source = new EventSource(this.urlFor(this.lastSeq));
    this.source = source;

    source.onopen = () => {
      this.attempts = 0;
      this.handlers.onOpen?.();
    };

    source.onmessage = (raw: MessageEvent<string>) => this.dispatch(raw);
    // Nest sets `event:` to the payload type, so named listeners are needed as well as onmessage.
    for (const type of ['status', 'plan', 'step', 'node.add', 'node.patch', 'node.remove', 'integration.add', 'schema.table', 'log', 'tokens', 'done', 'error']) {
      source.addEventListener(type, (raw) => this.dispatch(raw as MessageEvent<string>));
    }

    source.onerror = () => {
      if (this.closed) return;
      // readyState CLOSED means the browser will not retry on its own.
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        this.scheduleReconnect();
      }
    };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.source?.close();
    this.source = null;
  }

  private dispatch(raw: MessageEvent<string>): void {
    if (this.closed) return;
    let json: unknown;
    try {
      json = JSON.parse(raw.data);
    } catch {
      this.handlers.onError(new Error('Received a malformed event from the generation stream.'));
      return;
    }
    const parsed = GenerationEventSchema.safeParse(json);
    if (!parsed.success) {
      this.handlers.onError(new Error(`Generation event failed validation: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`));
      return;
    }
    const event = parsed.data;
    if (event.seq <= this.lastSeq) return;
    this.lastSeq = event.seq;
    this.handlers.onEvent(event);
    if (event.type === 'done' || event.type === 'error' || (event.type === 'status' && (event.status === 'cancelled' || event.status === 'failed'))) {
      this.close();
      this.handlers.onComplete();
    }
  }

  private scheduleReconnect(): void {
    if (this.attempts >= this.maxAttempts) {
      this.handlers.onError(new Error('Lost connection to the generation stream.'));
      this.close();
      return;
    }
    this.attempts += 1;
    const delay = Math.min(8000, 400 * 2 ** this.attempts) * (0.6 + Math.random() * 0.6);
    this.handlers.onReconnect?.(this.attempts);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }
}
