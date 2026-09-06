import { describe, expect, it } from 'vitest';
import { GenerationEventSchema, MadDocumentSchema, countNodes, insertNode, type MadNode } from '@mad/schema';
import { analyzePrompt } from './intents';
import { plan } from './planner';
import { PRESETS } from './presets';

const CANONICAL = 'Build an internal CRM dashboard with Stripe billing and a customer support chat';

describe('analyzePrompt', () => {
  it('detects the canonical intents and integrations', () => {
    const a = analyzePrompt(CANONICAL);
    expect(a.intents).toEqual(expect.arrayContaining(['crm', 'billing', 'support-chat', 'dashboard']));
    expect(a.integrations.map((i) => i.slug)).toEqual(expect.arrayContaining(['stripe', 'mad-chat', 'postgres']));
    expect(a.archetype).toBe('internal-tool');
  });

  it('never returns an empty intent list', () => {
    const a = analyzePrompt('something completely unrecognisable xyzzy');
    expect(a.intents.length).toBeGreaterThan(0);
    expect(a.integrations.some((i) => i.slug === 'postgres')).toBe(true);
  });

  it('keeps only the explicitly named vendor within a family', () => {
    const a = analyzePrompt('login with clerk and billing with paddle');
    const slugs = a.integrations.map((i) => i.slug);
    expect(slugs).toContain('clerk');
    expect(slugs).not.toContain('supabase-auth');
    expect(slugs).toContain('paddle');
    expect(slugs).not.toContain('stripe');
  });
});

describe('plan', () => {
  it('is deterministic for the same prompt', () => {
    const a = plan(CANONICAL);
    const b = plan(CANONICAL);
    expect(a.document).toEqual(b.document);
    expect(a.events).toEqual(b.events);
  });

  it('finishes well under the 60 second budget', () => {
    const result = plan(CANONICAL);
    expect(result.durationMs).toBeLessThan(30_000);
    expect(result.durationMs).toBeGreaterThan(3_000);
  });

  it('emits only schema-valid events and a schema-valid document', () => {
    const result = plan(CANONICAL);
    result.events.forEach((e, seq) => {
      const parsed = GenerationEventSchema.safeParse({ ...e.event, seq, at: new Date().toISOString() });
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    });
    expect(MadDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it('replaying node.add events reproduces the final document tree', () => {
    const result = plan(CANONICAL);
    let root: MadNode | null = null;
    for (const { event } of result.events) {
      if (event.type !== 'node.add') continue;
      root = root === null ? event.node : insertNode(root, event.parentId, event.index, event.node);
    }
    expect(root).not.toBeNull();
    expect(countNodes(root as MadNode)).toBe(countNodes(result.document.root));
    expect(JSON.stringify(root)).toBe(JSON.stringify(result.document.root));
  });

  it('reports the node count it actually produced', () => {
    const result = plan(CANONICAL);
    const done = result.events.map((e) => e.event).find((e) => e.type === 'done');
    expect(done && done.type === 'done' ? done.nodeCount : -1).toBe(countNodes(result.document.root));
  });

  it('collapses to an instant stream at pace 0', () => {
    const result = plan(CANONICAL, { pace: 0 });
    expect(result.events.every((e) => e.delayMs === 0)).toBe(true);
  });
});

describe('presets', () => {
  it('ships the same library for every design system', () => {
    const byDs = new Map<string, number>();
    for (const p of PRESETS) byDs.set(p.designSystem, (byDs.get(p.designSystem) ?? 0) + 1);
    expect([...byDs.values()]).toEqual([23, 23, 23]);
  });

  it('has unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
});
