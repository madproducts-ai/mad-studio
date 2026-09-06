import { z } from 'zod';

/**
 * The MAD Document is the single source of truth for a generated application.
 * It is a tree of typed nodes. The AI planner emits nodes, the canvas renders
 * them, and the property inspector patches them. Every node is addressable by
 * a stable id so streaming patches, undo history and drag-drop all converge on
 * the same structure.
 */

export const NODE_TYPES = [
  'page',
  'nav',
  'sidebar',
  'section',
  'stack',
  'grid',
  'card',
  'heading',
  'text',
  'button',
  'input',
  'select',
  'toggle',
  'badge',
  'avatar',
  'divider',
  'image',
  'stat',
  'chart',
  'table',
  'list',
  'tabs',
  'kanban',
  'form',
  'chat',
  'timeline',
  'pricing',
] as const;

export const NodeTypeSchema = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const NodeSourceSchema = z.enum(['ai', 'user', 'preset']);
export type NodeSource = z.infer<typeof NodeSourceSchema>;

/** Which visual preset library a node was authored in. Governs the renderer skin. */
export const DesignSystemSchema = z.enum(['tailwind', 'material', 'wordpress']);
export type DesignSystem = z.infer<typeof DesignSystemSchema>;

export const PropValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
]);
export type PropValue = z.infer<typeof PropValueSchema>;

export const SpacingSchema = z.object({
  top: z.number().int().min(0).max(160),
  right: z.number().int().min(0).max(160),
  bottom: z.number().int().min(0).max(160),
  left: z.number().int().min(0).max(160),
});
export type Spacing = z.infer<typeof SpacingSchema>;

export const StylePropsSchema = z
  .object({
    padding: SpacingSchema.optional(),
    margin: SpacingSchema.optional(),
    gap: z.number().int().min(0).max(96).optional(),
    radius: z.number().int().min(0).max(48).optional(),
    background: z.string().regex(/^(#[0-9a-fA-F]{6}|transparent|var\(--[a-z0-9-]+\))$/).optional(),
    foreground: z.string().regex(/^(#[0-9a-fA-F]{6}|var\(--[a-z0-9-]+\))$/).optional(),
    border: z.boolean().optional(),
    shadow: z.enum(['none', 'sm', 'md', 'lg']).optional(),
    width: z.enum(['auto', 'full', 'content', '1/2', '1/3', '2/3', '1/4', '3/4']).optional(),
    align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
    justify: z.enum(['start', 'center', 'end', 'between']).optional(),
    direction: z.enum(['row', 'column']).optional(),
    columns: z.number().int().min(1).max(12).optional(),
    hidden: z.boolean().optional(),
  })
  .strict();
export type StyleProps = z.infer<typeof StylePropsSchema>;

export const NodeIdSchema = z.string().regex(/^n_[a-z0-9]{8,16}$/, 'node id must look like n_xxxxxxxx');
export type NodeId = z.infer<typeof NodeIdSchema>;

export interface MadNode {
  id: NodeId;
  type: NodeType;
  name: string;
  props: Record<string, PropValue>;
  style: StyleProps;
  children: MadNode[];
  source: NodeSource;
  locked: boolean;
}

export const MadNodeSchema: z.ZodType<MadNode> = z.lazy(() =>
  z
    .object({
      id: NodeIdSchema,
      type: NodeTypeSchema,
      name: z.string().min(1).max(80),
      props: z.record(z.string(), PropValueSchema),
      style: StylePropsSchema,
      children: z.array(MadNodeSchema),
      source: NodeSourceSchema,
      locked: z.boolean(),
    })
    .strict(),
);

export const DeviceSchema = z.enum(['desktop', 'tablet', 'iphone', 'android']);
export type Device = z.infer<typeof DeviceSchema>;

export const DEVICE_VIEWPORTS: Record<Device, { width: number; height: number; label: string; radius: number }> = {
  desktop: { width: 1440, height: 900, label: 'Desktop 1440', radius: 12 },
  tablet: { width: 834, height: 1194, label: 'iPad Pro 11"', radius: 28 },
  iphone: { width: 393, height: 852, label: 'iPhone 15 Pro', radius: 54 },
  android: { width: 412, height: 915, label: 'Pixel 8', radius: 36 },
};

export const MadDocumentSchema = z
  .object({
    version: z.literal(1),
    designSystem: DesignSystemSchema,
    theme: z.enum(['dark', 'light']),
    root: MadNodeSchema,
    integrations: z.array(z.string()),
    tables: z.array(z.object({ table: z.string().min(1), columns: z.array(z.string().min(1)).min(1) })).default([]),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type MadDocument = z.infer<typeof MadDocumentSchema>;

/* ------------------------------------------------------------------ */
/* Inspector prop schemas: what the property panel shows per node type  */
/* ------------------------------------------------------------------ */

export const PropControlKindSchema = z.enum([
  'text',
  'textarea',
  'number',
  'select',
  'toggle',
  'color',
  'icon',
  'list',
  'records',
]);
export type PropControlKind = z.infer<typeof PropControlKindSchema>;

export interface PropControl {
  key: string;
  label: string;
  kind: PropControlKind;
  group: 'content' | 'data' | 'behaviour';
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
}

const text = (key: string, label: string, extra: Partial<PropControl> = {}): PropControl => ({
  key,
  label,
  kind: 'text',
  group: 'content',
  ...extra,
});
const select = (key: string, label: string, options: readonly string[], extra: Partial<PropControl> = {}): PropControl => ({
  key,
  label,
  kind: 'select',
  group: 'content',
  options,
  ...extra,
});
const toggle = (key: string, label: string, extra: Partial<PropControl> = {}): PropControl => ({
  key,
  label,
  kind: 'toggle',
  group: 'behaviour',
  ...extra,
});
const number = (key: string, label: string, min: number, max: number, step = 1): PropControl => ({
  key,
  label,
  kind: 'number',
  group: 'content',
  min,
  max,
  step,
});

export const NODE_PROP_CONTROLS: Record<NodeType, readonly PropControl[]> = {
  page: [text('title', 'Page title'), select('layout', 'Layout', ['app-shell', 'centered', 'landing'])],
  nav: [
    text('brand', 'Brand label'),
    { key: 'links', label: 'Links', kind: 'list', group: 'content', help: 'One label per line' },
    text('cta', 'Call to action'),
    toggle('sticky', 'Sticky'),
  ],
  sidebar: [
    { key: 'items', label: 'Navigation items', kind: 'list', group: 'content' },
    number('active', 'Active index', 0, 24),
    toggle('collapsible', 'Collapsible'),
  ],
  section: [text('title', 'Section title'), text('subtitle', 'Subtitle'), text('eyebrow', 'Eyebrow label')],
  stack: [],
  grid: [],
  card: [text('title', 'Title'), text('subtitle', 'Subtitle'), toggle('interactive', 'Hover lift')],
  heading: [
    text('text', 'Text'),
    select('level', 'Level', ['1', '2', '3', '4']),
    select('weight', 'Weight', ['medium', 'semibold', 'bold']),
  ],
  text: [
    { key: 'text', label: 'Text', kind: 'textarea', group: 'content' },
    select('tone', 'Tone', ['default', 'muted', 'accent']),
    select('size', 'Size', ['sm', 'md', 'lg']),
  ],
  button: [
    text('label', 'Label'),
    select('variant', 'Variant', ['primary', 'secondary', 'ghost', 'danger']),
    select('size', 'Size', ['sm', 'md', 'lg']),
    { key: 'icon', label: 'Icon', kind: 'icon', group: 'content' },
    toggle('disabled', 'Disabled'),
    toggle('fullWidth', 'Full width'),
  ],
  input: [
    text('label', 'Label'),
    text('placeholder', 'Placeholder'),
    select('inputType', 'Type', ['text', 'email', 'password', 'number', 'search', 'tel']),
    text('helper', 'Helper text'),
    toggle('required', 'Required'),
  ],
  select: [text('label', 'Label'), { key: 'options', label: 'Options', kind: 'list', group: 'content' }],
  toggle: [text('label', 'Label'), toggle('checked', 'Checked')],
  badge: [text('text', 'Text'), select('tone', 'Tone', ['neutral', 'success', 'warning', 'danger', 'info'])],
  avatar: [text('name', 'Name'), select('size', 'Size', ['sm', 'md', 'lg']), toggle('status', 'Show status')],
  divider: [text('label', 'Label')],
  image: [text('alt', 'Alt text'), select('ratio', 'Aspect ratio', ['16/9', '4/3', '1/1', '3/4'])],
  stat: [
    text('label', 'Label'),
    text('value', 'Value'),
    text('delta', 'Delta'),
    select('trend', 'Trend', ['up', 'down', 'flat']),
    toggle('sparkline', 'Sparkline'),
  ],
  chart: [
    text('title', 'Title'),
    select('kind', 'Chart type', ['line', 'bar', 'area', 'donut']),
    { key: 'series', label: 'Series (comma separated)', kind: 'list', group: 'data' },
    number('points', 'Data points', 4, 24),
  ],
  table: [
    text('title', 'Title'),
    { key: 'columns', label: 'Columns', kind: 'list', group: 'data' },
    number('rows', 'Rows', 1, 50),
    toggle('selectable', 'Row selection'),
    toggle('striped', 'Striped rows'),
  ],
  list: [{ key: 'items', label: 'Items', kind: 'list', group: 'content' }, toggle('ordered', 'Numbered')],
  tabs: [{ key: 'tabs', label: 'Tabs', kind: 'list', group: 'content' }, number('active', 'Active tab', 0, 12)],
  kanban: [{ key: 'columns', label: 'Columns', kind: 'list', group: 'data' }, number('cardsPerColumn', 'Cards per column', 1, 8)],
  form: [text('title', 'Title'), text('submitLabel', 'Submit label'), select('layout', 'Layout', ['single', 'two-column'])],
  chat: [
    text('title', 'Title'),
    text('agentName', 'Agent name'),
    text('placeholder', 'Composer placeholder'),
    toggle('showStatus', 'Show online status'),
  ],
  timeline: [{ key: 'events', label: 'Events', kind: 'list', group: 'data' }],
  pricing: [
    { key: 'tiers', label: 'Tiers', kind: 'list', group: 'data' },
    select('billing', 'Billing period', ['monthly', 'yearly']),
    number('highlight', 'Highlighted tier', 0, 4),
  ],
};

/** Node types that may accept children on the canvas. */
export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'page',
  'section',
  'stack',
  'grid',
  'card',
  'form',
  'tabs',
]);

export const isContainer = (type: NodeType): boolean => CONTAINER_TYPES.has(type);
