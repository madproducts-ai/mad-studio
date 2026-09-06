import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateRule {
  /** Sustained allowance per minute. */
  perMinute: number;
  /** Burst capacity. */
  burst: number;
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('rate_limited', 'Too many attempts. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS, { retryAfterSeconds });
  }
}

/**
 * In-process token buckets keyed by caller-supplied strings (ip, email).
 * Sufficient for a single API instance; a shared store would replace the map
 * if the API is ever scaled out. Idle buckets are swept periodically so the
 * map cannot grow without bound.
 */
@Injectable()
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  /** Consumes one token for `key` under `rule`, or throws RateLimitedError. */
  consume(key: string, rule: RateRule, now = Date.now()): void {
    this.sweep(now);
    const refillPerMs = rule.perMinute / 60_000;
    const bucket = this.buckets.get(key) ?? { tokens: rule.burst, updatedAt: now };
    bucket.tokens = Math.min(rule.burst, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      throw new RateLimitedError(Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > 10 * 60_000) this.buckets.delete(key);
    }
  }
}

export const RATE_RULES = {
  loginPerIp: { perMinute: 10, burst: 20 },
  loginPerEmail: { perMinute: 5, burst: 8 },
  registerPerIp: { perMinute: 2, burst: 5 },
} as const satisfies Record<string, RateRule>;
