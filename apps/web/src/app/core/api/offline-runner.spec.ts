import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationEvent } from '@mad/schema';
import { OfflineRunner } from './offline-runner';

const PROMPT = 'Build an internal CRM dashboard with Stripe billing and a customer support chat';

describe('OfflineRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits the full planner stream with contiguous seq and completes', () => {
    const events: GenerationEvent[] = [];
    let completed = 0;
    const runner = new OfflineRunner(PROMPT, { designSystem: 'tailwind', pace: 0 }, (e) => events.push(e), () => (completed += 1));
    runner.start();
    vi.runAllTimers();
    expect(completed).toBe(1);
    expect(events.length).toBeGreaterThan(40);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(events[0]?.type).toBe('status');
    expect(events[events.length - 1]?.type).toBe('done');
    const adds = events.filter((e) => e.type === 'node.add');
    expect(adds[0]?.type === 'node.add' && adds[0].parentId).toBeNull();
  });

  it('cancel stops the stream and emits a cancelled status once', () => {
    const events: GenerationEvent[] = [];
    let completed = 0;
    const runner = new OfflineRunner(PROMPT, { designSystem: 'tailwind', pace: 1 }, (e) => events.push(e), () => (completed += 1));
    runner.start();
    vi.advanceTimersByTime(1500);
    const before = events.length;
    runner.cancel();
    runner.cancel();
    vi.runAllTimers();
    expect(completed).toBe(1);
    expect(events.length).toBe(before + 1);
    const last = events[events.length - 1];
    expect(last?.type === 'status' && last.status).toBe('cancelled');
  });
});
