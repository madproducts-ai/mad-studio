import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MadDocumentSchema, NODE_TYPES, countNodes, type MadDocument, type MadNode, type NodeType } from '@mad/schema';
import { buildManifest, hostStyle, renderDocumentHtml, renderNodeHtml } from './render';
import { EXPORT_ICONS } from './icons';
import { RENDERER_CSS } from './renderer.css';
import { RUNTIME_JS } from './runtime.js.gen';

const repoRoot = resolve(__dirname, '../../..');

let counter = 0;
const node = (type: NodeType, props: MadNode['props'] = {}, children: MadNode[] = [], style: MadNode['style'] = {}): MadNode => ({
  id: `n_${(++counter).toString(36).padStart(8, 'x')}`,
  type,
  name: type,
  props,
  style,
  children,
  source: 'ai',
  locked: false,
});

const everyType: MadNode = node('page', { title: 'All types', layout: 'app-shell' }, [
  node('nav', { brand: 'Acme <Ops>', links: ['Home', 'Docs'], cta: 'Invite', sticky: true }),
  node('sidebar', { items: ['Overview', 'Billing'], active: 1 }),
  node('stack', {}, [
    node('section', { title: 'Overview', subtitle: 'Sub', eyebrow: 'EYE' }, [
      node('grid', {}, [node('stat', { label: 'MRR', value: '$48k', delta: '+4%', trend: 'up', sparkline: true }), node('chart', { title: 'Revenue', kind: 'area', series: ['MRR', 'New'], points: 12 })], { columns: 2 }),
      node('grid', {}, [node('chart', { kind: 'bar', series: ['Orders'], points: 8 }), node('chart', { kind: 'donut', series: ['A', 'B', 'C'] })], { columns: 2 }),
      node('card', { title: 'Card', subtitle: 'Sub' }, [node('heading', { text: 'H', level: 3 }), node('text', { text: 'Body "quoted"', tone: 'muted' })]),
      node('form', { title: 'New', submitLabel: 'Create', layout: 'two-column' }, [node('input', { label: 'Email', placeholder: 'you@x.com', inputType: 'email', required: true }), node('select', { label: 'Plan', options: ['Pro', 'Team'] }), node('toggle', { label: 'Notify', checked: true })]),
      node('tabs', { tabs: ['One', 'Two'], active: 1 }, [node('text', { text: 'first' }), node('table', { title: 'Rows', columns: ['Name', 'Status', 'MRR'], rows: 3, selectable: true })]),
      node('kanban', { columns: ['Lead', 'Won'], cardsPerColumn: 2 }),
      node('chat', { title: 'Support', agentName: 'Sam', showStatus: true }),
      node('timeline', { events: ['Created', 'Shipped'] }),
      node('pricing', { tiers: ['Starter', 'Growth', 'Scale'], billing: 'monthly', highlight: 1 }),
      node('list', { items: ['a', 'b'], ordered: true }),
      node('button', { label: 'Go', variant: 'secondary', icon: 'arrow', size: 'lg' }),
      node('badge', { text: 'Beta', tone: 'info' }),
      node('avatar', { name: 'Ada Lovelace', size: 'lg', status: true }),
      node('divider', { label: 'or' }),
      node('image', { alt: 'Shot', ratio: '4/3' }),
      node('text', { text: 'hidden' }, [], { hidden: true }),
    ]),
  ]),
]);

const doc: MadDocument = { version: 1, designSystem: 'tailwind', theme: 'dark', root: everyType, integrations: ['stripe'], tables: [{ table: 'deals', columns: ['id'] }], updatedAt: new Date(0).toISOString() };
const options = { title: 'All types <demo>', description: 'desc', target: 'preview' as const, version: 3, deployedAt: '2026-09-06T10:00:00.000Z', deploymentId: 'dep-1', studioUrl: 'https://studio.madproducts.ai/studio/p1' };

describe('renderNodeHtml', () => {
  it('renders every node type into the same class vocabulary as the canvas', () => {
    expect(MadDocumentSchema.safeParse(doc).success).toBe(true);
    const html = renderNodeHtml(everyType);
    for (const type of NODE_TYPES) expect(html, type).toContain(`data-node-type="${type}"`);
    for (const cls of ['r-page', 'r-nav', 'r-sidebar', 'r-section', 'r-stack', 'r-grid', 'r-card', 'r-form', 'r-tabs', 'r-heading', 'r-text', 'r-btn', 'r-field', 'r-select', 'r-toggle', 'r-badge', 'r-avatar', 'r-divider', 'r-image', 'r-stat', 'r-chart', 'r-table', 'r-list', 'r-kanban', 'r-chat', 'r-timeline', 'r-pricing']) {
      expect(html, cls).toMatch(new RegExp(`class="[^"]*\\b${cls}\\b`));
    }
    expect(html).toContain('r-node r-hidden');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('<polyline points=');
    expect(html).toContain('<linearGradient');
    expect(html).toContain('class="bar"');
    expect(html).toContain('stroke-dasharray=');
  });

  it('escapes user-controlled text and attributes', () => {
    const html = renderNodeHtml(everyType);
    expect(html).toContain('Acme &lt;Ops&gt;');
    expect(html).toContain('Body &quot;quoted&quot;');
    expect(html).not.toContain('<Ops>');
    const evil = node('text', { text: '<script>alert(1)</script>' });
    expect(renderNodeHtml(evil)).not.toContain('<script>');
  });

  it('is deterministic and keeps sample data stable per node id', () => {
    const a = renderNodeHtml(everyType);
    const b = renderNodeHtml(everyType);
    expect(a).toBe(b);
  });

  it('maps style props onto host custom properties exactly like the canvas', () => {
    expect(hostStyle({ padding: { top: 1, right: 2, bottom: 3, left: 4 }, gap: 8, radius: 12, columns: 3, width: '1/2', align: 'start', justify: 'between', direction: 'row', border: false, shadow: 'md', background: '#112233' })).toBe(
      'padding:1px 2px 3px 4px;--r-gap:8px;--r-radius:12px;--r-bg-override:#112233;--r-cols:3;--r-width:calc(1/2 * 100%);--r-align:flex-start;--r-justify:space-between;--r-direction:row;--r-border-w:0px;--r-shadow:var(--r-shadow-md)',
    );
  });
});

describe('renderDocumentHtml', () => {
  it('produces a standalone page with inline styles, fonts, badge and deployment marker', () => {
    const html = renderDocumentHtml(doc, options);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>All types &lt;demo&gt;</title>');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('data-mad-deployment="dep-1"');
    expect(html).toContain('data-ds="tailwind"');
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('Built with MAD Studio');
    expect(html).toContain(RENDERER_CSS.slice(0, 200));
    expect(html).toContain("setAttribute('data-device'");
    expect(renderDocumentHtml(doc, { ...options, target: 'production', fonts: false })).not.toContain('noindex');
    expect(renderDocumentHtml(doc, { ...options, fonts: false })).not.toContain('fonts.googleapis.com');
  });

  it('ships the behaviour runtime, and can be asked not to', () => {
    expect(renderDocumentHtml(doc, options)).toContain(RUNTIME_JS);
    const inert = renderDocumentHtml(doc, { ...options, interactive: false });
    expect(inert).not.toContain(RUNTIME_JS);
    // The device script is not part of the runtime and stays either way.
    expect(inert).toContain("setAttribute('data-device'");
  });

  it('builds a manifest that summarises the document', () => {
    expect(buildManifest(doc, options)).toMatchObject({ generator: 'mad-studio', deploymentId: 'dep-1', version: 3, nodeCount: countNodes(everyType), tables: ['deals'], integrations: ['stripe'] });
  });
});

describe('controls a person can actually use', () => {
  // The page used to be a picture: every control was a span, so a deployed app
  // had one focusable element in the whole document.
  const html = renderNodeHtml(everyType);

  it('emits real controls rather than styled spans', () => {
    expect(html).toMatch(/<button type="button" class="[^"]*r-btn/);
    expect(html).toMatch(/<input class="r-input"/);
    expect(html).toMatch(/<select class="r-input r-select"/);
    expect(html).toMatch(/<input type="checkbox" class="r-check"/);
    expect(html).toContain('<button type="submit"');
    expect(html).toContain('<button type="reset"');
    expect(html).not.toContain('onsubmit');
    expect(html).not.toContain('class="r-placeholder"');
  });

  it('binds every field label to its control', () => {
    for (const match of html.matchAll(/<label class="r-label" for="([^"]+)"/g)) {
      expect(html, match[1]).toContain(`id="${match[1]}"`);
    }
    expect(html).toMatch(/<label class="r-label" for="[^"]+">Email/);
  });

  it('offers every option of a select, not just the first', () => {
    expect(html).toContain('<option value="Pro" selected>Pro</option>');
    expect(html).toContain('<option value="Team">Team</option>');
  });

  it('ships every tab panel so switching needs no round trip', () => {
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
    expect(html).toContain('aria-controls="n_xxxxxxxi-panel-0"');
    expect(html).toContain('aria-labelledby="n_xxxxxxxi-tab-0"');
    expect(html).toContain('first');
  });

  it('marks a sortable column so a screen reader can hear the order', () => {
    expect(html).toContain('<th scope="col" aria-sort="none">');
    expect(html).toContain('class="r-th-sort"');
  });

  it('names the controls that are only an icon', () => {
    for (const match of html.matchAll(/<button type="button" class="r-icon-btn"([^>]*)>/g)) {
      expect(match[1], match[0]).toContain('aria-label=');
    }
  });

  it('closes void elements properly', () => {
    expect(html).not.toContain('</input>');
    expect(html).not.toContain('</img>');
  });
});

describe('parity with the studio renderer', () => {
  it('ships a stylesheet generated from the current canvas CSS (run npm run sync:export-css)', async () => {
    const mod = (await import(/* @vite-ignore */ new URL('../../../scripts/sync-export-css.mjs', import.meta.url).href)) as { buildRendererCss: (root: string) => string };
    expect(RENDERER_CSS).toBe(mod.buildRendererCss(repoRoot));
    expect(RENDERER_CSS).not.toContain(':host');
    expect(RENDERER_CSS).not.toContain('mad-node');
    expect(RENDERER_CSS).toContain(".r-frame[data-device='iphone']");
    expect(RENDERER_CSS).toContain("[data-ds='material'] .r-btn");
  });

  it('ships a runtime built from the current source (run npm run build:runtime)', async () => {
    const mod = (await import(/* @vite-ignore */ new URL('../../../scripts/build-runtime.mjs', import.meta.url).href)) as { buildRuntimeJs: (root: string) => Promise<string> };
    expect(RUNTIME_JS).toBe(await mod.buildRuntimeJs(repoRoot));
    // Inlined into HTML, so a closing tag anywhere in it would end the script early.
    expect(RUNTIME_JS).not.toMatch(/<\/script/i);
  });

  it('uses icon paths identical to the studio icon set', () => {
    const source = readFileSync(resolve(repoRoot, 'apps/web/src/app/core/ui/icon.component.ts'), 'utf8');
    for (const [name, path] of Object.entries(EXPORT_ICONS)) {
      const key = /^[a-z]+$/.test(name) ? name : `'${name}'`;
      expect(source, name).toContain(`${key}: '${path}'`);
    }
  });
});
