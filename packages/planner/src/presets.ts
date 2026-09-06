import type { ComponentPreset, DesignSystem, MadNode } from '@mad/schema';
import { createIdFactory } from '@mad/schema';
import { type BuildContext, badge, button, card, chart, chat, form, grid, heading, input, kanban, list, pricing, row, select, stack, stat, table, tabs, text, timeline, toggle, image } from './builders';

/**
 * The drag-and-drop component library. Presets are authored once per design
 * system with the same node vocabulary; the renderer applies the skin. Ids are
 * regenerated when a preset is dropped, so these are templates, not instances.
 */

const ctxFor = (designSystem: DesignSystem): BuildContext => ({
  nextId: createIdFactory(0x5eed),
  designSystem,
  random: () => 0.42,
});

const preset = (
  ds: DesignSystem,
  id: string,
  category: ComponentPreset['category'],
  name: string,
  description: string,
  keywords: string[],
  build: (ctx: BuildContext) => MadNode,
): ComponentPreset => {
  const ctx = ctxFor(ds);
  const node = build(ctx);
  return { id: `p_${ds}-${id}`, designSystem: ds, category, name, description, keywords, node: { ...node, source: 'preset' } };
};

const common = (ds: DesignSystem): ComponentPreset[] => [
  preset(ds, 'stat-card', 'data', 'Stat card', 'KPI with delta and sparkline', ['kpi', 'metric', 'number'], (c) => stat(c, 'Revenue', '$128.4k', '+8.2%', 'up')),
  preset(ds, 'kpi-row', 'data', 'KPI row', 'Four stats in a responsive grid', ['kpi', 'metrics', 'overview'], (c) =>
    grid(c, 'KPI row', 4, [stat(c, 'MRR', '$84.2k', '+6.1%', 'up'), stat(c, 'Customers', '1,284', '+3.4%', 'up'), stat(c, 'Churn', '1.2%', '-0.3%', 'down'), stat(c, 'NPS', '62', '+4', 'up')]),
  ),
  preset(ds, 'area-chart', 'data', 'Area chart', 'Trend with two series', ['chart', 'trend', 'line'], (c) => chart(c, 'Revenue trend', 'area', ['This year', 'Last year'], 12)),
  preset(ds, 'bar-chart', 'data', 'Bar chart', 'Categorical comparison', ['chart', 'bars', 'funnel'], (c) => chart(c, 'Funnel', 'bar', ['Visited', 'Signed up', 'Activated', 'Paid'], 4)),
  preset(ds, 'donut-chart', 'data', 'Donut chart', 'Share of total', ['chart', 'donut', 'pie'], (c) => chart(c, 'Plan mix', 'donut', ['Starter', 'Growth', 'Scale'], 3)),
  preset(ds, 'data-table', 'data', 'Data table', 'Sortable, selectable rows', ['table', 'grid', 'rows'], (c) => table(c, 'Customers', ['Name', 'Company', 'Status', 'Plan', 'MRR'], 6)),
  preset(ds, 'kanban', 'data', 'Kanban board', 'Draggable columns of cards', ['board', 'pipeline', 'tasks'], (c) => kanban(c, 'Pipeline', ['Todo', 'In progress', 'Review', 'Done'], 3)),
  preset(ds, 'timeline', 'data', 'Activity timeline', 'Chronological feed', ['activity', 'feed', 'events'], (c) => timeline(c, 'Activity', ['Deal closed', 'Invoice paid', 'New ticket', 'Deploy shipped'])),
  preset(ds, 'card', 'layout', 'Card', 'Titled surface with padding', ['container', 'panel'], (c) => card(c, 'Card title', [text(c, 'Drop components here.')], 'Optional subtitle')),
  preset(ds, 'two-column', 'layout', 'Two columns', 'Equal split grid', ['grid', 'columns', 'split'], (c) => grid(c, 'Two columns', 2, [card(c, 'Left', [text(c, 'First column')]), card(c, 'Right', [text(c, 'Second column')])])),
  preset(ds, 'three-column', 'layout', 'Three columns', 'Feature grid', ['grid', 'features'], (c) => grid(c, 'Three columns', 3, [card(c, 'One', [text(c, 'First')]), card(c, 'Two', [text(c, 'Second')]), card(c, 'Three', [text(c, 'Third')])])),
  preset(ds, 'section-header', 'layout', 'Section header', 'Eyebrow, heading, description', ['heading', 'title', 'intro'], (c) => stack(c, 'Section header', [badge(c, 'SECTION', 'neutral'), heading(c, 'Section title', 2, 'semibold'), text(c, 'One sentence that explains what this section is for.')], { gap: 8, align: 'start' })),
  preset(ds, 'tabs', 'navigation', 'Tabs', 'Segmented views', ['tabs', 'segments', 'views'], (c) => tabs(c, 'Tabs', ['Overview', 'Details', 'Activity'], [text(c, 'Overview content'), text(c, 'Details content'), text(c, 'Activity content')])),
  preset(ds, 'toolbar', 'navigation', 'Toolbar', 'Search plus actions', ['search', 'actions', 'header'], (c) => row(c, 'Toolbar', [input(c, '', 'Search…', 'search'), row(c, 'Actions', [button(c, 'Export', 'secondary', 'download'), button(c, 'New', 'primary', 'plus')], { justify: 'end' })])),
  preset(ds, 'contact-form', 'forms', 'Contact form', 'Two-column form with submit', ['form', 'contact', 'inputs'], (c) => form(c, 'Contact us', [input(c, 'Name', 'Full name', 'text', true), input(c, 'Email', 'you@company.com', 'email', true), select(c, 'Topic', ['Sales', 'Support', 'Partnership']), input(c, 'Message', 'How can we help?', 'text')], 'Send message')),
  preset(ds, 'login-form', 'forms', 'Sign-in form', 'Email, password, remember me', ['login', 'auth', 'signin'], (c) => form(c, 'Sign in', [input(c, 'Email', 'you@company.com', 'email', true), input(c, 'Password', '••••••••', 'password', true), toggle(c, 'Remember me', true)], 'Sign in', 'single')),
  preset(ds, 'settings-toggles', 'forms', 'Preference toggles', 'A list of switches', ['settings', 'switch', 'preferences'], (c) => card(c, 'Notifications', [toggle(c, 'Email digests', true), toggle(c, 'Push notifications', false), toggle(c, 'Weekly summary', true)])),
  preset(ds, 'pricing', 'commerce', 'Pricing table', 'Three tiers with highlight', ['pricing', 'plans', 'tiers'], (c) => pricing(c, ['Starter', 'Growth', 'Scale'], 1)),
  preset(ds, 'product-card', 'commerce', 'Product card', 'Image, title, price', ['product', 'shop', 'catalog'], (c) => card(c, 'Studio Desk Lamp', [image(c, 'Product photo', '4/3'), row(c, 'Price row', [text(c, '$148', 'default'), button(c, 'Add to cart', 'secondary', 'cart', 'sm')])])),
  preset(ds, 'chat', 'communication', 'Chat panel', 'Conversation with composer', ['chat', 'support', 'messages'], (c) => chat(c, 'Support', 'Ari (support)')),
  preset(ds, 'inbox-list', 'communication', 'Inbox list', 'Conversation list', ['inbox', 'list', 'tickets'], (c) => card(c, 'Open conversations', [list(c, 'Conversations', ['Priya N. · Billing question', 'Marcus T. · SSO loop', 'Elena R. · Exports'])], '12 open')),
  preset(ds, 'hero', 'marketing', 'Hero', 'Headline, copy, two CTAs', ['hero', 'landing', 'headline'], (c) => stack(c, 'Hero', [badge(c, 'New', 'info'), heading(c, 'Ship the thing.', 1, 'bold'), text(c, 'A single sentence that sells the outcome, not the feature.', 'muted', 'lg'), row(c, 'CTAs', [button(c, 'Start free', 'primary', 'arrow', 'lg'), button(c, 'See demo', 'ghost', '', 'lg')], { justify: 'start' })], { align: 'start', gap: 16 })),
  preset(ds, 'cta-banner', 'marketing', 'CTA banner', 'Email capture', ['cta', 'waitlist', 'newsletter'], (c) => card(c, 'Stay in the loop', [row(c, 'CTA row', [input(c, '', 'you@company.com', 'email'), button(c, 'Subscribe', 'primary', 'arrow')])], 'No spam. Unsubscribe any time.')),
];

export const PRESETS: readonly ComponentPreset[] = [...common('tailwind'), ...common('material'), ...common('wordpress')];

export const presetsFor = (designSystem: DesignSystem): ComponentPreset[] => PRESETS.filter((p) => p.designSystem === designSystem);

export const PRESET_CATEGORIES: ReadonlyArray<{ id: ComponentPreset['category']; label: string }> = [
  { id: 'layout', label: 'Layout' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'data', label: 'Data' },
  { id: 'forms', label: 'Forms' },
  { id: 'commerce', label: 'Commerce' },
  { id: 'communication', label: 'Communication' },
  { id: 'marketing', label: 'Marketing' },
];
