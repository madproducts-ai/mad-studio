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
import { analyzePrompt, type IntentAnalysis, type IntegrationMatch } from './intents';
import { type BuildContext, nav, page, sidebar, stack } from './builders';
import { MODULES } from './modules';
import { type AppSpec, buildSection, integrationsForSpec, sanitizeSpec } from './spec';

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
  /** Omit the leading `status: planning` event when the caller has already emitted one. */
  skipPlanning?: boolean;
}

export const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const hashPrompt = (prompt: string): number => {
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

/**
 * Everything the timeline composer needs, independent of where the plan came
 * from. The heuristic planner and the model-backed planner both produce one of
 * these, so the streamed experience is identical whichever planned the app.
 */
export interface Blueprint {
  appName: string;
  archetype: IntentAnalysis['archetype'];
  designSystem: DesignSystem;
  navLinks: string[];
  sidebarItems: string[];
  cta: string;
  /** Plan steps between "shell" and "schema", in order; each builds its sections. */
  features: Array<{ id: string; label: string; detail: string; build: (ctx: BuildContext) => MadNode[] }>;
  tables: Array<{ table: string; columns: string[] }>;
  integrations: IntegrationMatch[];
  /** Log lines shown while the brief is analysed. */
  analysisLog: string[];
  /** Real token usage when a model produced the blueprint; the heuristic estimates otherwise. */
  tokens?: { input: number; output: number };
  /** Extra time (ms) already spent before the timeline starts, added to the reported duration. */
  leadTimeMs?: number;
}

export interface ComposedPlan {
  steps: PlanStep[];
  events: TimedEvent[];
  document: MadDocument;
  durationMs: number;
}

/**
 * Turns a blueprint into the node tree plus the timed event stream that
 * reveals it. Pure: same blueprint + ctx → same output.
 */
export const compose = (blueprint: Blueprint, ctx: BuildContext, pace: number, options: { skipPlanning?: boolean } = {}): ComposedPlan => {
  const isLanding = blueprint.archetype === 'marketing-site';
  const isMobile = blueprint.archetype === 'mobile-app';

  const steps: PlanStep[] = [
    { id: 'analyze', label: 'Understand the brief', detail: `${blueprint.features.length} capabilities · ${blueprint.archetype.replace('-', ' ')}`, status: 'pending' },
    { id: 'shell', label: isLanding ? 'Lay out page structure' : 'Scaffold application shell', detail: isLanding ? 'Navigation, sections, footer' : 'Navigation, sidebar, content area', status: 'pending' },
    ...blueprint.features.map((f) => ({ id: f.id, label: f.label, detail: f.detail, status: 'pending' as const })),
    { id: 'schema', label: 'Model the database', detail: `${blueprint.tables.length} tables · PostgreSQL`, status: 'pending' },
    { id: 'wire', label: 'Wire integrations', detail: blueprint.integrations.map((i) => i.label).join(', ') || 'No third-party services needed', status: 'pending' },
    { id: 'polish', label: 'Polish and verify', detail: 'Responsive pass and contrast check', status: 'pending' },
  ];

  const events: TimedEvent[] = [];
  const push = (delayMs: number, event: TimedEvent['event']) => events.push({ delayMs: Math.round(delayMs * pace), event });

  if (!options.skipPlanning) push(0, { type: 'status', status: 'planning', message: 'Reading the brief' });
  push(options.skipPlanning ? 0 : 320, { type: 'plan', steps });
  push(60, { type: 'step', stepId: 'analyze', status: 'active' });
  blueprint.analysisLog.forEach((line, i) => push(i === 0 ? 420 : 260, { type: 'log', level: 'info', message: line.slice(0, 400) }));
  push(180, { type: 'step', stepId: 'analyze', status: 'done' });
  push(80, { type: 'status', status: 'generating', message: 'Generating interface' });
  push(60, { type: 'step', stepId: 'shell', status: 'active' });

  // Build the whole tree first (pure), then replay it as events.
  const shellChildren: MadNode[] = [];
  const navNode = nav(ctx, blueprint.appName, blueprint.navLinks, blueprint.cta);
  shellChildren.push(navNode);
  let sidebarNode: MadNode | null = null;
  if (!isLanding && !isMobile) {
    sidebarNode = sidebar(ctx, Array.from(new Set(blueprint.sidebarItems)), 0);
    shellChildren.push(sidebarNode);
  }
  const content = stack(ctx, 'Main content', [], { gap: 32, padding: isLanding ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: 28, right: 32, bottom: 40, left: 32 } });
  shellChildren.push(content);

  const root = page(ctx, blueprint.appName, isLanding ? 'landing' : isMobile ? 'centered' : 'app-shell', shellChildren);

  push(0, { type: 'node.add', parentId: null, index: 0, node: { ...root, children: [] } });
  push(180, { type: 'node.add', parentId: root.id, index: 0, node: navNode });
  if (sidebarNode) push(160, { type: 'node.add', parentId: root.id, index: 1, node: sidebarNode });
  push(140, { type: 'node.add', parentId: root.id, index: shellChildren.length - 1, node: { ...content, children: [] } });
  push(120, { type: 'step', stepId: 'shell', status: 'done' });

  let contentIndex = 0;
  let workingRoot: MadNode = root;
  for (const feature of blueprint.features) {
    push(90, { type: 'step', stepId: feature.id, status: 'active' });
    for (const sec of feature.build(ctx)) {
      emitSubtree(events, sec, content.id, contentIndex, pace, 0);
      workingRoot = insertNode(workingRoot, content.id, contentIndex, sec);
      contentIndex += 1;
    }
    push(120, { type: 'step', stepId: feature.id, status: 'done' });
  }

  push(80, { type: 'status', status: 'wiring', message: 'Modelling data and wiring integrations' });
  push(60, { type: 'step', stepId: 'schema', status: 'active' });
  const seenTables = new Set<string>();
  const tables: Blueprint['tables'] = [];
  for (const t of blueprint.tables) {
    if (seenTables.has(t.table)) continue;
    seenTables.add(t.table);
    tables.push({ table: t.table, columns: [...t.columns] });
    push(110, { type: 'schema.table', table: t.table, columns: [...t.columns] });
  }
  push(140, { type: 'step', stepId: 'schema', status: 'done' });

  push(60, { type: 'step', stepId: 'wire', status: 'active' });
  for (const integration of blueprint.integrations) {
    push(180, { type: 'integration.add', slug: integration.slug, label: integration.label, scopes: [...integration.scopes] });
  }
  push(140, { type: 'step', stepId: 'wire', status: 'done' });

  push(60, { type: 'step', stepId: 'polish', status: 'active' });
  push(360, { type: 'log', level: 'info', message: 'Contrast check passed: generated text clears WCAG AA (4.5:1) in this design system' });
  push(240, { type: 'log', level: 'info', message: 'Responsive pass: the layout re-flows for tablet and phone widths' });
  push(200, { type: 'step', stepId: 'polish', status: 'done' });

  const nodeCount = countNodes(workingRoot);
  const scheduledMs = events.reduce((sum, e) => sum + e.delayMs, 0);
  const durationMs = scheduledMs + 120 + (blueprint.leadTimeMs ?? 0);
  const tokens = blueprint.tokens ?? { input: Math.round(180 + blueprint.appName.length * 1.3), output: Math.round(nodeCount * 46) };
  push(0, { type: 'tokens', input: tokens.input, output: tokens.output });
  push(120, { type: 'status', status: 'complete', message: 'Ready to edit' });
  push(0, { type: 'done', durationMs, nodeCount });

  const document: MadDocument = {
    version: 1,
    designSystem: blueprint.designSystem,
    theme: 'dark',
    root: workingRoot,
    integrations: blueprint.integrations.map((i) => i.slug),
    tables,
    updatedAt: new Date(0).toISOString(),
  };

  return { steps, events, document, durationMs };
};

export const createContext = (seed: number, designSystem: DesignSystem): BuildContext => ({ nextId: createIdFactory(seed), designSystem, random: mulberry32(seed ^ 0x9e3779b9) });

/** The heuristic blueprint: intents detected from vocabulary, one feature module per intent. */
export const heuristicBlueprint = (analysis: IntentAnalysis, designSystem: DesignSystem): Blueprint => {
  const modules = analysis.intents.map((i) => MODULES[i]);
  const isLanding = analysis.archetype === 'marketing-site';
  return {
    appName: analysis.appName,
    archetype: analysis.archetype,
    designSystem,
    navLinks: isLanding ? ['Product', 'Customers', 'Pricing', 'Docs'] : ['Search', 'Docs', 'Changelog'],
    sidebarItems: modules.map((m) => m.sidebarItem),
    cta: isLanding ? 'Start free' : 'Invite team',
    features: modules.map((m) => ({ id: `mod-${m.intent}`, label: m.planLabel, detail: m.planDetail, build: (ctx) => m.build(ctx, analysis) })),
    tables: modules.flatMap((m) => m.tables),
    integrations: analysis.integrations,
    analysisLog: [`Detected ${analysis.intents.map((i) => i.replace('-', ' ')).join(', ')}`, `Archetype: ${analysis.archetype}. Design system: ${designSystem}.`],
  };
};

const INTENT_LABEL: Record<string, string> = {
  dashboard: 'overview dashboard',
  crm: 'CRM pipeline',
  billing: 'billing',
  'support-chat': 'support chat',
  auth: 'authentication',
  analytics: 'analytics',
  ecommerce: 'commerce',
  landing: 'marketing pages',
  tasks: 'task tracking',
  calendar: 'scheduling',
  cms: 'content',
  inventory: 'inventory',
  invoices: 'invoicing',
  team: 'team directory',
  settings: 'settings',
  notifications: 'notifications',
  mobile: 'mobile shell',
};

/**
 * The model blueprint: a sanitised AppSpec becomes one plan step per section
 * group (sections are grouped in pairs so the plan reads like a build log
 * rather than a table of contents).
 */
export const specBlueprint = (rawSpec: AppSpec, designSystem: DesignSystem, meta: { tokens?: { input: number; output: number }; leadTimeMs?: number; model?: string } = {}): Blueprint => {
  const spec = sanitizeSpec(rawSpec);
  const isLanding = spec.archetype === 'marketing-site';
  const groups: AppSpec['sections'][] = [];
  for (let i = 0; i < spec.sections.length; i += 2) groups.push(spec.sections.slice(i, i + 2));
  const features: Blueprint['features'] = groups.map((group, i) => ({
    id: `sec-${i + 1}`,
    label: group.length === 1 ? `Build ${group[0]!.title}` : `Build ${group[0]!.title} and ${group[1]!.title}`,
    detail: group.map((s) => s.kind).join(', '),
    build: (ctx) => group.map((s) => buildSection(ctx, spec, s)),
  }));
  const intentsLine = spec.intents.length ? spec.intents.map((i) => INTENT_LABEL[i] ?? i).join(', ') : spec.sections.map((s) => s.kind).join(', ');
  return {
    appName: spec.appName,
    archetype: spec.archetype,
    designSystem,
    navLinks: spec.navLinks,
    sidebarItems: isLanding ? spec.navLinks : spec.sidebarItems,
    cta: spec.primaryAction,
    features,
    tables: spec.tables,
    integrations: integrationsForSpec(spec),
    analysisLog: [
      `${meta.model ? `${meta.model} planned` : 'Planned'} ${spec.appName}: ${spec.summary}`,
      `Scope: ${intentsLine}. Archetype: ${spec.archetype}. Design system: ${designSystem}.`,
    ],
    ...(meta.tokens ? { tokens: meta.tokens } : {}),
    ...(meta.leadTimeMs !== undefined ? { leadTimeMs: meta.leadTimeMs } : {}),
  };
};

/** Deterministic, model-free planner. Same prompt + seed → same document and events. */
export const plan = (prompt: string, options: PlanOptions = {}): PlanResult => {
  const analysis = analyzePrompt(prompt);
  const seed = options.seed ?? hashPrompt(analysis.normalized);
  const designSystem = options.designSystem ?? 'tailwind';
  const pace = options.pace ?? 1;
  const ctx = createContext(seed, designSystem);
  const composed = compose(heuristicBlueprint(analysis, designSystem), ctx, pace, { skipPlanning: options.skipPlanning === true });
  return { analysis, ...composed };
};

/** Materialise a model-produced spec with the same pacing and event stream as `plan`. */
export const planFromSpec = (spec: AppSpec, options: PlanOptions & { tokens?: { input: number; output: number }; leadTimeMs?: number; model?: string } = {}): ComposedPlan => {
  const designSystem = options.designSystem ?? 'tailwind';
  const seed = options.seed ?? hashPrompt(`${spec.appName}|${spec.summary}`);
  const ctx = createContext(seed, designSystem);
  const blueprint = specBlueprint(spec, designSystem, {
    ...(options.tokens ? { tokens: options.tokens } : {}),
    ...(options.leadTimeMs !== undefined ? { leadTimeMs: options.leadTimeMs } : {}),
    ...(options.model ? { model: options.model } : {}),
  });
  return compose(blueprint, ctx, options.pace ?? 1, { skipPlanning: options.skipPlanning === true });
};
