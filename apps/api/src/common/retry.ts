/**
 * Exponential back-off with full jitter. Used around every outbound call
 * (database, future third-party SDKs) so transient failures never surface
 * as user-facing errors on the first hiccup.
 */
export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  /** Return false to stop retrying for this error (e.g. a 4xx). */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  signal?: AbortSignal;
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public override readonly cause: unknown,
  ) {
    super(`Operation failed after ${attempts} attempts: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'RetryExhaustedError';
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const withRetry = async <T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> => {
  const attempts = options.attempts ?? 4;
  const baseMs = options.baseMs ?? 120;
  const maxMs = options.maxMs ?? 4000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = options.shouldRetry?.(error, attempt) ?? true;
      // A non-retryable failure (constraint violation, conflict, not found) is the
      // caller's error to handle: surface it unchanged so typed errors keep their identity.
      if (!retryable) throw error;
      if (attempt === attempts) break;
      const cap = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delay = Math.round(Math.random() * cap);
      options.onRetry?.(error, attempt, delay);
      await sleep(delay, options.signal);
    }
  }
  throw new RetryExhaustedError(attempts, lastError);
};
