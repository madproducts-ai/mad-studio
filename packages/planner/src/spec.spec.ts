import { describe, expect, it } from 'vitest';
import { GenerationEventSchema, MadDocumentSchema, countNodes } from '@mad/schema';
import { plan, planFromSpec } from './planner';
import { AppSpecSchema, SECTION_KINDS, sanitizeSpec, type AppSpec } from './spec';

const SPEC: AppSpec = {
  appName: 'Northwind Ops.',
  summary: 'Back-office for a wholesale distributor: orders, stock and supplier billing.',
  archetype: 'internal-tool',
  navLinks: ['Search', 'Docs', 'Docs', 'Changelog'],
  sidebarItems: ['Overview', 'Orders', 'Inventory', 'Suppliers', 'Billing'],
  primaryAction: 'New order',
  sections: [
    { title: 'Overview', subtitle: 'Today at a glance', eyebrow: 'ops', kind: 'kpis', items: ['Open orders', 'Revenue (30d)', 'Fill rate', 'Late shipments'], actions: [] },
    { title: 'Orders', subtitle: '', eyebrow: '', kind: 'table', items: ['Order', 'Customer', 'Status', 'Total', 'Ship by'], actions: ['Export', 'New order'] },
    { title: 'Fulfilment', subtitle: 'Pick, pack, ship', eyebrow: '', kind: 'kanban', items: ['Queued', 'Picking', 'Packed', 'Shipped'], actions: [] },
    { title: 'Supplier billing', subtitle: '', eyebrow: '', kind: 'chart', items: ['Invoiced', 'Paid'], actions: [] },
    { title: 'New supplier', subtitle: '', eyebrow: '', kind: 'form', items: ['Company', 'Contact email', 'Payment terms', 'Preferred'], actions: ['Save supplier'] },
  ],
  tables: [
    { table: 'orders', columns: ['id', 'customer_id', 'status', 'total_cents', 'ship_by', 'created_at'] },
    { table: 'orders', columns: ['id'] },
    { table: 'suppliers', columns: ['id', 'name', 'contact_email', 'payment_terms', 'created_at'] },
  ],
  integrations: ['stripe', 'postgres', 'not-a-real-vendor', 'stripe'],
  intents: ['dashboard', 'inventory', 'billing', 'dashboard'],
  sampleTerms: ['Pallet 22 short-shipped', 'Reorder point hit for SKU 4471', 'Pallet 22 short-shipped'],
};

describe('AppSpec', () => {
  it('validates the sample spec and rejects unknown section kinds', () => {
    expect(AppSpecSchema.safeParse(SPEC).success).toBe(true);
    const bad = { ...SPEC, sections: [{ ...SPEC.sections[0], kind: 'carousel' }] };
    expect(AppSpecSchema.safeParse(bad).success).toBe(false);
    expect(SECTION_KINDS).toContain('kpis');
  });

  it('sanitises names, duplicates and unknown integrations', () => {
    const clean = sanitizeSpec(SPEC);
    expect(clean.appName).toBe('Northwind Ops');
    expect(clean.navLinks).toEqual(['Search', 'Docs', 'Changelog']);
    expect(clean.tables.map((t) => t.table)).toEqual(['orders', 'suppliers']);
    expect(clean.integrations).toEqual(['stripe', 'postgres']);
    expect(clean.sampleTerms).toEqual(['Pallet 22 short-shipped', 'Reorder point hit for SKU 4471']);
    expect(clean.intents).toEqual(['dashboard', 'inventory', 'billing']);
  });
});

describe('planFromSpec', () => {
  it('materialises a valid document whose stream rebuilds the same tree', () => {
    const result = planFromSpec(SPEC, { pace: 0, tokens: { input: 1200, output: 640 }, leadTimeMs: 4200, model: 'claude-opus-5' });
    expect(MadDocumentSchema.safeParse(result.document).success).toBe(true);
    expect(result.document.root.name).toBe('Northwind Ops');
    expect(result.document.tables.map((t) => t.table)).toEqual(['orders', 'suppliers']);
    expect(result.document.integrations).toEqual(['stripe', 'postgres']);

    const types = result.events.map((e) => e.event.type);
    expect(types[0]).toBe('status');
    expect(types).toContain('plan');
    expect(types.filter((t) => t === 'schema.table')).toHaveLength(2);
    expect(types.filter((t) => t === 'integration.add')).toHaveLength(2);
    const tokens = result.events.find((e) => e.event.type === 'tokens')?.event;
    expect(tokens).toMatchObject({ input: 1200, output: 640 });
    const done = result.events[result.events.length - 1]?.event;
    expect(done).toMatchObject({ type: 'done', nodeCount: countNodes(result.document.root) });
    expect(result.durationMs).toBeGreaterThanOrEqual(4200);
    // Every event validates once the stream assigns seq/at.
    result.events.forEach((e, i) => expect(GenerationEventSchema.safeParse({ ...e.event, seq: i, at: new Date().toISOString() }).success).toBe(true));
    // Every section kind produced a section node under the main content area.
    const content = result.document.root.children.find((c) => c.name === 'Main content');
    expect(content?.children.map((c) => c.type)).toEqual(['section', 'section', 'section', 'section', 'section']);
    expect(content?.children[1]?.children.some((c) => c.type === 'table')).toBe(true);
    expect(content?.children[2]?.children.some((c) => c.type === 'kanban')).toBe(true);
    // The board is populated with the domain's own vocabulary, not the renderer's generic sample tasks.
    const board = content?.children[2]?.children.find((c) => c.type === 'kanban');
    expect(board?.props['cards']).toEqual(['Pallet 22 short-shipped', 'Reorder point hit for SKU 4471']);
  });

  it('renders every section kind without throwing', () => {
    const sections = SECTION_KINDS.map((kind) => ({ title: `${kind} section`, subtitle: '', eyebrow: '', kind, items: [], actions: [] }));
    const result = planFromSpec({ ...SPEC, archetype: 'marketing-site', sections }, { pace: 0 });
    expect(MadDocumentSchema.safeParse(result.document).success).toBe(true);
    expect(result.document.root.props['layout']).toBe('landing');
    expect(result.document.root.children.some((c) => c.type === 'sidebar')).toBe(false);
  });

  it('is deterministic for the same spec and skips the planning status on request', () => {
    const a = planFromSpec(SPEC, { pace: 1 });
    const b = planFromSpec(SPEC, { pace: 1 });
    expect(a.document).toEqual(b.document);
    const heuristic = plan('Build an internal CRM dashboard', { pace: 0, skipPlanning: true });
    expect(heuristic.events[0]?.event.type).toBe('plan');
    expect(plan('Build an internal CRM dashboard', { pace: 0 }).events[0]?.event).toMatchObject({ type: 'status', status: 'planning' });
  });
});
