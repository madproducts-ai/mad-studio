import { describe, expect, it, vi } from 'vitest';
import { RetryExhaustedError, withRetry } from './retry';

class Transient extends Error {
  code = '57P01';
}
class Permanent extends Error {
  code = '23505';
}

const isTransient = (e: unknown) => (e as { code?: string }).code === '57P01';

describe('withRetry', () => {
  it('returns the first successful result', async () => {
    const op = vi.fn(async () => 'ok');
    await expect(withRetry(op, { attempts: 3, baseMs: 1 })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and succeeds', async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Transient('connection reset');
      return 'recovered';
    });
    await expect(withRetry(op, { attempts: 4, baseMs: 1, maxMs: 2, shouldRetry: isTransient })).resolves.toBe('recovered');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('rethrows non-retryable errors unchanged, without retrying', async () => {
    const op = vi.fn(async () => {
      throw new Permanent('duplicate key');
    });
    await expect(withRetry(op, { attempts: 4, baseMs: 1, shouldRetry: isTransient })).rejects.toBeInstanceOf(Permanent);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('wraps in RetryExhaustedError only after all attempts fail transiently', async () => {
    const op = vi.fn(async () => {
      throw new Transient('still down');
    });
    const error = await withRetry(op, { attempts: 3, baseMs: 1, maxMs: 2, shouldRetry: isTransient }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect((error as RetryExhaustedError).attempts).toBe(3);
    expect((error as RetryExhaustedError).cause).toBeInstanceOf(Transient);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('stops waiting when the signal aborts', async () => {
    const controller = new AbortController();
    const op = vi.fn(async () => {
      throw new Transient('down');
    });
    const pending = withRetry(op, { attempts: 5, baseMs: 5000, maxMs: 5000, shouldRetry: isTransient, signal: controller.signal });
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
  });
});
