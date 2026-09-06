import type { MadNode, NodeId, NodeType, PropValue, StyleProps, DesignSystem } from '@mad/schema';

/**
 * Small node factory. Every builder returns a fully-populated MadNode with
 * sensible defaults so the renderer never has to guard against missing props.
 */

export interface BuildContext {
  nextId: () => NodeId;
  designSystem: DesignSystem;
  random: () => number;
}

const pad = (v: number) => ({ top: v, right: v, bottom: v, left: v });

export const node = (
  ctx: BuildContext,
  type: NodeType,
  name: string,
  props: Record<string, PropValue> = {},
  style: StyleProps = {},
  children: MadNode[] = [],
): MadNode => ({
  id: ctx.nextId(),
  type,
  name,
  props,
  style,
  children,
  source: 'ai',
  locked: false,
});

export const heading = (ctx: BuildContext, text: string, level: 1 | 2 | 3 | 4 = 2, weight: 'medium' | 'semibold' | 'bold' = 'semibold') =>
  node(ctx, 'heading', text.length > 24 ? `${text.slice(0, 22)}…` : text, { text, level: String(level), weight });

export const text = (ctx: BuildContext, value: string, tone: 'default' | 'muted' | 'accent' = 'muted', size: 'sm' | 'md' | 'lg' = 'md') =>
  node(ctx, 'text', value.length > 24 ? `${value.slice(0, 22)}…` : value, { text: value, tone, size });

export const button = (
  ctx: BuildContext,
  label: string,
  variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'primary',
  icon = '',
  size: 'sm' | 'md' | 'lg' = 'md',
) => node(ctx, 'button', label, { label, variant, size, icon, disabled: false, fullWidth: false });

export const badge = (ctx: BuildContext, value: string, tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' = 'neutral') =>
  node(ctx, 'badge', value, { text: value, tone });

export const input = (ctx: BuildContext, label: string, placeholder: string, inputType = 'text', required = false, helper = '') =>
  node(ctx, 'input', label || placeholder || 'Input', { label, placeholder, inputType, helper, required });

export const stack = (ctx: BuildContext, name: string, children: MadNode[], style: StyleProps = {}) =>
  node(ctx, 'stack', name, {}, { direction: 'column', gap: 16, align: 'stretch', ...style }, children);

export const row = (ctx: BuildContext, name: string, children: MadNode[], style: StyleProps = {}) =>
  node(ctx, 'stack', name, {}, { direction: 'row', gap: 12, align: 'center', justify: 'between', ...style }, children);

export const grid = (ctx: BuildContext, name: string, columns: number, children: MadNode[], style: StyleProps = {}) =>
  node(ctx, 'grid', name, {}, { columns, gap: 16, ...style }, children);

export const card = (ctx: BuildContext, title: string, children: MadNode[], subtitle = '', style: StyleProps = {}) =>
  node(ctx, 'card', title, { title, subtitle, interactive: false }, { padding: pad(20), radius: 12, border: true, shadow: 'sm', ...style }, children);

export const section = (ctx: BuildContext, title: string, children: MadNode[], subtitle = '', eyebrow = '') =>
  node(ctx, 'section', title, { title, subtitle, eyebrow }, { padding: { top: 0, right: 0, bottom: 0, left: 0 }, gap: 16 }, children);

export const stat = (ctx: BuildContext, label: string, value: string, delta: string, trend: 'up' | 'down' | 'flat') =>
  node(ctx, 'stat', label, { label, value, delta, trend, sparkline: true });

export const chart = (ctx: BuildContext, title: string, kind: 'line' | 'bar' | 'area' | 'donut', series: string[], points = 12) =>
  node(ctx, 'chart', title, { title, kind, series, points });

export const table = (ctx: BuildContext, title: string, columns: string[], rows = 6, selectable = true) =>
  node(ctx, 'table', title, { title, columns, rows, selectable, striped: false });

export const list = (ctx: BuildContext, name: string, items: string[], ordered = false) => node(ctx, 'list', name, { items, ordered });

export const tabs = (ctx: BuildContext, name: string, labels: string[], children: MadNode[], active = 0) =>
  node(ctx, 'tabs', name, { tabs: labels, active }, { gap: 16 }, children);

export const kanban = (ctx: BuildContext, name: string, columns: string[], cardsPerColumn = 3) =>
  node(ctx, 'kanban', name, { columns, cardsPerColumn });

export const chat = (ctx: BuildContext, title: string, agentName: string) =>
  node(ctx, 'chat', title, { title, agentName, placeholder: 'Type a reply…', showStatus: true });

export const form = (ctx: BuildContext, title: string, children: MadNode[], submitLabel = 'Save', layout: 'single' | 'two-column' = 'two-column') =>
  node(ctx, 'form', title, { title, submitLabel, layout }, { gap: 16 }, children);

export const avatar = (ctx: BuildContext, name: string, size: 'sm' | 'md' | 'lg' = 'md') => node(ctx, 'avatar', name, { name, size, status: true });

export const divider = (ctx: BuildContext, label = '') => node(ctx, 'divider', label || 'Divider', { label });

export const timeline = (ctx: BuildContext, name: string, events: string[]) => node(ctx, 'timeline', name, { events });

export const pricing = (ctx: BuildContext, tiers: string[], highlight = 1) =>
  node(ctx, 'pricing', 'Pricing', { tiers, billing: 'monthly', highlight });

export const image = (ctx: BuildContext, alt: string, ratio: '16/9' | '4/3' | '1/1' | '3/4' = '16/9') => node(ctx, 'image', alt, { alt, ratio });

export const toggle = (ctx: BuildContext, label: string, checked = false) => node(ctx, 'toggle', label, { label, checked });

export const select = (ctx: BuildContext, label: string, options: string[]) => node(ctx, 'select', label, { label, options });

export const nav = (ctx: BuildContext, brand: string, links: string[], cta: string) =>
  node(ctx, 'nav', 'Top navigation', { brand, links, cta, sticky: true });

export const sidebar = (ctx: BuildContext, items: string[], active = 0) =>
  node(ctx, 'sidebar', 'Sidebar', { items, active, collapsible: true });

export const page = (ctx: BuildContext, title: string, layout: 'app-shell' | 'centered' | 'landing', children: MadNode[]) =>
  node(ctx, 'page', title, { title, layout }, {}, children);

/** Seeded pseudo-random helpers for believable but stable sample data. */
export const pick = <T>(ctx: BuildContext, items: readonly T[]): T => {
  const idx = Math.floor(ctx.random() * items.length);
  return items[Math.min(idx, items.length - 1)] as T;
};

export const money = (ctx: BuildContext, min: number, max: number): string => {
  const v = min + ctx.random() * (max - min);
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
};

export const percent = (ctx: BuildContext, min: number, max: number, sign = true): string => {
  const v = min + ctx.random() * (max - min);
  const s = v.toFixed(1);
  return sign && v > 0 ? `+${s}%` : `${s}%`;
};
