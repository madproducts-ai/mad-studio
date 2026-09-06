import { describe, expect, it } from 'vitest';
import { cellFor, chatThread, hashSeed, initials, personName, rng, series, taskCard } from './fake-data';

describe('fake-data', () => {
  it('hashes the same id to the same seed', () => {
    expect(hashSeed('n_abc123')).toBe(hashSeed('n_abc123'));
    expect(hashSeed('n_abc123')).not.toBe(hashSeed('n_abc124'));
  });

  it('produces a deterministic stream per seed', () => {
    const a = rng(42);
    const b = rng(42);
    const first = Array.from({ length: 5 }, () => a());
    const second = Array.from({ length: 5 }, () => b());
    expect(first).toEqual(second);
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('shapes cells by column semantics', () => {
    const r = rng(7);
    expect(cellFor('Email', r, 0)).toMatch(/^[a-z]+@[a-z]+\.com$/);
    expect(cellFor('MRR', r, 0)).toMatch(/^\$[\d,]+$/);
    expect(cellFor('Invoice', r, 3)).toMatch(/^#\d{4}$/);
    expect(['Active', 'Trial', 'Past due', 'Churn risk', 'Paused', 'Onboarding']).toContain(cellFor('Status', r, 0));
  });

  it('keeps series values inside the drawable range', () => {
    const data = series(rng(99), 24, 0.8);
    expect(data).toHaveLength(24);
    for (const v of data) {
      expect(v).toBeGreaterThanOrEqual(0.12);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('builds initials from a person name', () => {
    expect(initials(personName(rng(3)))).toMatch(/^[A-Z]{2}$/);
    expect(initials('Ada')).toBe('A');
  });

  it('threads alternate customer and agent with increasing timestamps', () => {
    const thread = chatThread(rng(11), 'Ari');
    expect(thread.map((m) => m.from)).toEqual(['customer', 'agent', 'customer']);
    expect(thread[1]?.name).toBe('Ari');
    expect(thread.every((m) => /^\d{2}:\d{2}$/.test(m.time))).toBe(true);
  });

  it('task cards carry a priority in P0–P3', () => {
    expect(taskCard(rng(5)).priority).toMatch(/^P[0-3]$/);
  });
});
