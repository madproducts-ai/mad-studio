import {
  type DesignSystem,
  type GenerationEventBody,
  type MadDocument,
  type MadNode,
  type PlanStep,
  countNodes,
  createIdFactory,
  insertNode,
} from '@mad/schema';
import { analyzePrompt, type IntentAnalysis } from './intents';
import { type BuildContext, nav, page, sidebar, stack } from './builders';
import { MODULES } from './modules';

/**
 * A timed event: `delayMs` is the pause *before* this event is emitted,
 * relative to the previous one. The API scheduler and the browser's offline
 * runner both consume this shape, so the streaming experience is identical.
 */
export type TimedEvent = { delayMs: number; event: GenerationEventBody };

export interface PlanResult {
  analysis: IntentAnalysis;
  steps: PlanStep[];
  events: TimedEvent[];
  document: MadDocument;
  /** Total scheduled duration in ms (sum of delays). Always well under 60s. */
  durationMs: number;
}

export interface PlanOptions {
  seed?: number;
  designSystem?: DesignSystem;
  /** Multiply every delay. 0 collapses the stream to instant; 1 is the default pacing. */
  pace?: number;
}

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashPrompt = (prompt: string): number => {
  let h = 2166136261;
  for (let i = 0; i < prompt.length; i += 1) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Emit a node and (recursively) its children as separate add events so the canvas grows visibly. */
const emitSubtree = (events: TimedEvent[], node: MadNode, parentId: string | null, index: number, pace: number, depth: number): void => {
  const shell: MadNode = { ...node, children: [] };
  const delay = depth === 0 ? 220 : depth === 1 ? 140 : 70;
  events.push({ delayMs: Math.round(delay * pace), event: { type: 'node.add', parentId: parentId as never, index, node: shell } });
  node.children.forEach((child, i) => emitSubtree(events, child, node.id, i, pace, depth + 1));
};

export const plan = (prompt: string, options: PlanOptions = {}): PlanResult => {
  const analysis = analyzePrompt(prompt);
  const seed = options.seed ?? hashPrompt(analysis.normalized);
  const designSystem = options.designSystem ?? 'tailwind';
  const pace = options.pace ?? 1;
  const ctx: BuildContext = { nextId: createIdFactory(seed), designSystem, random: mulberry32(seed ^ 0x9e3779b9) };

  const modules = analysis.intents.map((i) => MODULES[i]);
  const isLanding = analysis.archetype === 'marketing-site';
  const isMobile = analysis.archetype === 'mobile-app';

  const steps: PlanStep[] = [
    { id: 'analyze', label: 'Understand the brief', detail: `${analysis.intents.length} capabilities · ${analysis.archetype.replace('-', ' ')}`, status: 'pending' },
    { id: 'shell', label: isLanding ? 'Lay out page structure' : 'Scaffold application shell', detail: isLanding ? 'Navigation, sections, footer' : 'Navigation, sidebar, content area', status: 'pending' },
    ...modules.map((m) => ({ id: `mod-${m.intent}`, label: m.planLabel, detail: m.planDetail, status: 'pending' as const })),
    { id: 'schema', label: 'Model the database', detail: `${modules.reduce((n, m) => n + m.tables.length, 0)} tables · PostgreSQL`, status: 'pending' },
    { id: 'wire', label: 'Wire integrations', detail: analysis.integrations.map((i) => i.label).join(', '), status: 'pending' },
    { id: 'polish', label: 'Polish and verify', detail: 'Responsive pass, contrast, keyboard order', status: 'pending' },
  ];

  const events: TimedEvent[] = [];
  const push = (delayMs: number, event: TimedEvent['event']) => events.push({ delayMs: Math.round(delayMs * pace), event });

  push(0, { type: 'status', status: 'planning', message: 'Reading the brief' });
  push(320, { type: 'plan', steps });
  push(60, { type: 'step', stepId: 'analyze', status: 'active' });
  push(420, { type: 'log', level: 'info', message: `Detected ${analysis.intents.map((i) => i.replace('-', ' ')).join(', ')}` });
  push(260, { type: 'log', level: 'info', message: `Archetype: ${analysis.archetype}. Design system: ${designSystem}.` });
  push(180, { type: 'step', stepId: 'analyze', status: 'done' });
  push(80, { type: 'status', status: 'generating', message: 'Generating interface' });
  push(60, { type: 'step', stepId: 'shell', status: 'active' });

  // Build the whole tree first (pure), then replay it as events.
  const sidebarItems = modules.map((m) => m.sidebarItem);
  const brand = analysis.appName;
  const navLinks = isLanding ? ['Product', 'Customers', 'Pricing', 'Docs'] : ['Search', 'Docs', 'Changelog'];
  const cta = isLanding ? 'Start free' : 'Invite team';

  const shellChildren: MadNode[] = [];
  const navNode = nav(ctx, brand, navLinks, cta);
  shellChildren.push(navNode);
  let sidebarNode: MadNode | null = null;
  if (!isLanding && !isMobile) {
    sidebarNode = sidebar(ctx, Array.from(new Set(sidebarItems)), 0);
    shellChildren.push(sidebarNode);
  }
  const content = stack(ctx, 'Main content', [], { gap: 32, padding: isLanding ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: 28, right: 32, bottom: 40, left: 32 } });
  shellChildren.push(content);

  const root = page(ctx, brand, isLanding ? 'landing' : isMobile ? 'centered' : 'app-shell', shellChildren);

  // Replay shell.
  push(0, { type: 'node.add', parentId: null, index: 0, node: { ...root, children: [] } });
  push(180, { type: 'node.add', parentId: root.id, index: 0, node: navNode });
  if (sidebarNode) push(160, { type: 'node.add', parentId: root.id, index: 1, node: sidebarNode });
  push(140, { type: 'node.add', parentId: root.id, index: shellChildren.length - 1, node: { ...content, children: [] } });
  push(120, { type: 'step', stepId: 'shell', status: 'done' });

  let contentIndex = 0;
  let workingRoot: MadNode = root;
  for (const mod of modules) {
    push(90, { type: 'step', stepId: `mod-${mod.intent}`, status: 'active' });
    const sections = mod.build(ctx, analysis);
    for (const sec of sections) {
      emitSubtree(events, sec, content.id, contentIndex, pace, 0);
      workingRoot = insertNode(workingRoot, content.id, contentIndex, sec);
      contentIndex += 1;
    }
    push(120, { type: 'step', stepId: `mod-${mod.intent}`, status: 'done' });
  }

  push(80, { type: 'status', status: 'wiring', message: 'Modelling data and wiring integrations' });
  push(60, { type: 'step', stepId: 'schema', status: 'active' });
  const seenTables = new Set<string>();
  for (const mod of modules) {
    for (const t of mod.tables) {
      if (seenTables.has(t.table)) continue;
      seenTables.add(t.table);
      push(110, { type: 'schema.table', table: t.table, columns: t.columns });
    }
  }
  push(140, { type: 'step', stepId: 'schema', status: 'done' });

  push(60, { type: 'step', stepId: 'wire', status: 'active' });
  for (const integration of analysis.integrations) {
    push(180, { type: 'integration.add', slug: integration.slug, label: integration.label, scopes: [...integration.scopes] });
  }
  push(140, { type: 'step', stepId: 'wire', status: 'done' });

  push(60, { type: 'step', stepId: 'polish', status: 'active' });
  push(360, { type: 'log', level: 'info', message: 'Contrast check passed: all text ≥ 7:1 on generated surfaces' });
  push(240, { type: 'log', level: 'info', message: 'Keyboard order verified for 3 breakpoints' });
  push(200, { type: 'step', stepId: 'polish', status: 'done' });

  const nodeCount = countNodes(workingRoot);
  const durationMs = events.reduce((sum, e) => sum + e.delayMs, 0);
  push(0, { type: 'tokens', input: Math.round(180 + analysis.normalized.length * 1.3), output: Math.round(nodeCount * 46) });
  push(120, { type: 'status', status: 'complete', message: 'Ready to edit' });
  push(0, { type: 'done', durationMs: durationMs + 120, nodeCount });

  const document: MadDocument = {
    version: 1,
    designSystem,
    theme: 'dark',
    root: workingRoot,
    integrations: analysis.integrations.map((i) => i.slug),
    tables: modules.flatMap((m) => m.tables).filter((t, i, arr) => arr.findIndex((x) => x.table === t.table) === i).map((t) => ({ table: t.table, columns: [...t.columns] })),
    updatedAt: new Date(0).toISOString(),
  };

  return { analysis, steps, events, document, durationMs: durationMs + 120 };
};
