import { z } from 'zod';
import type { MadNode } from '@mad/schema';
import { INTEGRATION_RULES, INTENTS, type Intent, type IntegrationMatch } from './intents';
import {
  type BuildContext,
  badge,
  button,
  card,
  chart,
  chat,
  divider,
  form,
  grid,
  heading,
  image,
  input,
  kanban,
  list,
  money,
  percent,
  pricing,
  row,
  section,
  select,
  stack,
  stat,
  table,
  tabs,
  text,
  timeline,
  toggle,
} from './builders';

/**
 * The application spec a model produces from a prompt. It is deliberately
 * coarse: the model decides *what* the app contains (sections, their kind,
 * their labels, the data model, the integrations) and the materializer below
 * decides *how* that becomes a node tree, reusing the same builders as the
 * heuristic planner. That keeps every generated document renderable, keeps
 * the property inspector's controls valid, and keeps the model's output small
 * enough to return well inside the 60-second budget.
 *
 * Structured outputs require a closed schema: every object is strict and
 * every field is required (use empty arrays / empty strings, not omissions).
 */

export const SECTION_KINDS = ['kpis', 'chart', 'table', 'kanban', 'chat', 'form', 'cards', 'list', 'timeline', 'pricing', 'hero', 'settings', 'gallery', 'tabs'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const AppSpecSectionSchema = z
  .object({
    /** Short heading shown above the section. */
    title: z.string().min(1).max(60),
    /** One-line supporting copy; empty string when none. */
    subtitle: z.string().max(140),
    /** Small uppercase eyebrow label; empty string when none. */
    eyebrow: z.string().max(24),
    kind: z.enum(SECTION_KINDS),
    /**
     * Labels the section is built from. Meaning depends on kind:
     * kpis → metric names · chart → series names · table → column headers ·
     * kanban → lane names · form → field labels · cards/list/timeline/gallery → item titles ·
     * pricing → tier names · settings → toggle labels · tabs → tab labels · hero → [headline, CTA, secondary CTA] · chat → [assistant name].
     */
    items: z.array(z.string().min(1).max(60)).max(12),
    /** Buttons rendered in the section header; empty array when none. */
    actions: z.array(z.string().min(1).max(30)).max(3),
  })
  .strict();
export type AppSpecSection = z.infer<typeof AppSpecSectionSchema>;

export const AppSpecSchema = z
  .object({
    /** Product name, 2–4 words, no trailing punctuation. */
    appName: z.string().min(2).max(48),
    /** One sentence describing the product for the project description. */
    summary: z.string().min(1).max(200),
    archetype: z.enum(['internal-tool', 'saas', 'marketplace', 'marketing-site', 'mobile-app']),
    /** Top navigation links (2–5). */
    navLinks: z.array(z.string().min(1).max(24)).min(2).max(5),
    /** Sidebar entries for app shells (2–8). Ignored for marketing sites. */
    sidebarItems: z.array(z.string().min(1).max(24)).min(2).max(8),
    /** Primary call-to-action in the top bar. */
    primaryAction: z.string().min(1).max(24),
    sections: z.array(AppSpecSectionSchema).min(1).max(8),
    tables: z
      .array(
        z
          .object({
            /** snake_case table name. */
            table: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
            /** snake_case column names; include id and timestamps where sensible. */
            columns: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/)).min(1).max(16),
          })
          .strict(),
      )
      .max(10),
    /** Integration slugs from the MAD catalog (see INTEGRATION_RULES). Unknown slugs are dropped. */
    integrations: z.array(z.string().min(1).max(40)).max(8),
    /** The feature intents the brief implies; drives plan-step labels. */
    intents: z.array(z.enum(INTENTS)).max(6),
    /**
     * Short, concrete work items someone in this domain would actually see on a
     * board: the sample data that makes a generated app feel like the real thing
     * rather than a template. Empty is allowed; the renderer then uses its own.
     */
    sampleTerms: z.array(z.string().min(1).max(70)).max(12),
  })
  .strict();
export type AppSpec = z.infer<typeof AppSpecSchema>;

export const KNOWN_INTEGRATION_SLUGS: readonly string[] = INTEGRATION_RULES.map((r) => r.slug);

/**
 * Normalises a model-produced spec: drops unknown integrations, dedupes labels,
 * clamps counts, and guarantees the invariants the materializer relies on.
 */
export const sanitizeSpec = (spec: AppSpec): AppSpec => {
  const dedupe = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));
  const sections = spec.sections.map((s) => ({ ...s, title: s.title.trim() || 'Section', items: dedupe(s.items), actions: dedupe(s.actions).slice(0, 3) }));
  const seen = new Set<string>();
  const tables = spec.tables
    .filter((t) => (seen.has(t.table) ? false : (seen.add(t.table), true)))
    .map((t) => ({ table: t.table, columns: dedupe(t.columns).length ? dedupe(t.columns) : ['id'] }));
  return {
    ...spec,
    appName: spec.appName.trim().replace(/[.!]+$/, '') || 'Untitled App',
    navLinks: dedupe(spec.navLinks).slice(0, 5),
    sidebarItems: dedupe(spec.sidebarItems).slice(0, 8),
    sections,
    tables,
    integrations: dedupe(spec.integrations).filter((slug) => KNOWN_INTEGRATION_SLUGS.includes(slug)),
    sampleTerms: dedupe(spec.sampleTerms),
    intents: Array.from(new Set(spec.intents)) as Intent[],
  };
};

export const integrationsForSpec = (spec: AppSpec): IntegrationMatch[] =>
  spec.integrations.map((slug) => INTEGRATION_RULES.find((r) => r.slug === slug)).filter((r): r is IntegrationMatch => r !== undefined);

const fallbackItems = (kind: SectionKind, title: string): string[] => {
  switch (kind) {
    case 'kpis':
      return ['Active users', 'Revenue', 'Conversion', 'Churn'];
    case 'chart':
      return ['Current', 'Previous'];
    case 'table':
      return ['Name', 'Status', 'Owner', 'Updated'];
    case 'kanban':
      return ['Backlog', 'In progress', 'Review', 'Done'];
    case 'form':
      return ['Name', 'Email', 'Notes'];
    case 'cards':
    case 'gallery':
      return ['Item one', 'Item two', 'Item three'];
    case 'list':
      return ['First item', 'Second item', 'Third item'];
    case 'timeline':
      return ['Created', 'Updated', 'Reviewed'];
    case 'pricing':
      return ['Starter', 'Growth', 'Scale'];
    case 'settings':
      return ['Email notifications', 'Two-factor authentication', 'Weekly digest'];
    case 'tabs':
      return ['Overview', 'Details', 'Activity'];
    case 'hero':
      return [`${title}: built for teams who ship.`, 'Get started', 'Book a demo'];
    case 'chat':
      return ['Assistant'];
    default:
      return [];
  }
};

const TREND: ReadonlyArray<'up' | 'down' | 'flat'> = ['up', 'up', 'down', 'flat'];

const isMoneyLabel = (label: string) => /revenue|mrr|arr|sales|gmv|spend|cost|value|pipeline|price|income|payout/i.test(label);
const isPercentLabel = (label: string) => /rate|churn|conversion|margin|ratio|uptime|share|nps|csat|retention/i.test(label);

const kpiValue = (ctx: BuildContext, label: string): string => {
  if (isMoneyLabel(label)) return money(ctx, 24000, 480000);
  if (isPercentLabel(label)) return percent(ctx, 1.2, 38, false);
  return String(Math.round(120 + ctx.random() * 9800)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

const headerActions = (ctx: BuildContext, actions: string[]): MadNode | null => {
  if (actions.length === 0) return null;
  return row(
    ctx,
    'Section actions',
    actions.map((label, i) => button(ctx, label, i === actions.length - 1 ? 'primary' : 'secondary', i === actions.length - 1 ? 'plus' : '')),
    { justify: 'end' },
  );
};

/** Materialises one spec section into a node subtree using the shared builders. */
export const buildSection = (ctx: BuildContext, spec: AppSpec, s: AppSpecSection): MadNode => {
  const items = s.items.length ? s.items : fallbackItems(s.kind, s.title);
  const actions = headerActions(ctx, s.actions);
  const children: MadNode[] = [];
  if (actions) children.push(actions);

  switch (s.kind) {
    case 'kpis': {
      const stats = items.slice(0, 4).map((label, i) => stat(ctx, label, kpiValue(ctx, label), percent(ctx, i === 2 ? -9 : 1, i === 2 ? -1 : 14), TREND[i] ?? 'up'));
      children.push(grid(ctx, 'KPI row', Math.max(2, Math.min(4, stats.length)), stats));
      break;
    }
    case 'chart':
      children.push(chart(ctx, s.title, items.length > 3 ? 'bar' : 'area', items.slice(0, 4), 12));
      break;
    case 'table':
      children.push(table(ctx, s.title, items.slice(0, 7), 8));
      break;
    case 'kanban':
      children.push(kanban(ctx, s.title, items.slice(0, 6), 3, spec.sampleTerms));
      break;
    case 'chat':
      children.push(chat(ctx, s.title, items[0] ?? 'Assistant'));
      break;
    case 'form': {
      const fields = items.slice(0, 8).map((label) => {
        const lower = label.toLowerCase();
        if (/email/.test(lower)) return input(ctx, label, 'you@company.com', 'email', true);
        if (/phone|mobile/.test(lower)) return input(ctx, label, '+1 555 0100', 'tel');
        if (/date|when|deadline|due/.test(lower)) return input(ctx, label, 'YYYY-MM-DD', 'date');
        if (/amount|price|budget|quantity|qty/.test(lower)) return input(ctx, label, '0', 'number');
        if (/status|stage|type|category|role|plan|priority/.test(lower)) return select(ctx, label, ['Option A', 'Option B', 'Option C']);
        if (/enable|allow|notify|active|public/.test(lower)) return toggle(ctx, label, false);
        return input(ctx, label, label, 'text');
      });
      children.push(form(ctx, s.title, fields, s.actions[0] ?? 'Save', fields.length > 3 ? 'two-column' : 'single'));
      break;
    }
    case 'cards':
      children.push(
        grid(
          ctx,
          `${s.title} cards`,
          Math.min(3, Math.max(2, items.length)),
          items.slice(0, 6).map((title) => card(ctx, title, [text(ctx, `${title} — key details, owner and current status at a glance.`)])),
        ),
      );
      break;
    case 'gallery':
      children.push(grid(ctx, `${s.title} gallery`, Math.min(4, Math.max(2, items.length)), items.slice(0, 8).map((alt) => image(ctx, alt, '4/3'))));
      break;
    case 'list':
      children.push(card(ctx, s.title, [list(ctx, `${s.title} list`, items.slice(0, 10))]));
      break;
    case 'timeline':
      children.push(card(ctx, s.title, [timeline(ctx, `${s.title} timeline`, items.slice(0, 8))]));
      break;
    case 'pricing':
      children.push(pricing(ctx, items.slice(0, 4), Math.min(1, items.length - 1)));
      break;
    case 'settings':
      children.push(card(ctx, s.title, items.slice(0, 8).map((label, i) => toggle(ctx, label, i % 2 === 0))));
      break;
    case 'tabs':
      children.push(
        tabs(
          ctx,
          s.title,
          items.slice(0, 5),
          items.slice(0, 5).map((label) => table(ctx, label, ['Name', 'Status', 'Owner', 'Updated'], 6)),
        ),
      );
      break;
    case 'hero': {
      const [headline, primary, secondary] = [items[0] ?? `${spec.appName}: built for teams who ship.`, items[1] ?? 'Get started', items[2] ?? 'Book a demo'];
      children.push(
        stack(
          ctx,
          'Hero copy',
          [
            badge(ctx, s.eyebrow || 'New', 'info'),
            heading(ctx, headline, 1, 'bold'),
            text(ctx, s.subtitle || spec.summary, 'muted', 'lg'),
            row(ctx, 'Hero actions', [button(ctx, primary, 'primary', 'arrow', 'lg'), button(ctx, secondary, 'ghost', '', 'lg')], { justify: 'start' }),
          ],
          { align: 'start', gap: 20 },
        ),
        image(ctx, 'Product screenshot', '16/9'),
      );
      break;
    }
    default:
      children.push(divider(ctx));
  }

  return section(ctx, s.title, children, s.kind === 'hero' ? '' : s.subtitle, s.kind === 'hero' ? '' : s.eyebrow.toUpperCase());
};
