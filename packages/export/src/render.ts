import type { DesignSystem, MadDocument, MadNode, PropValue, StyleProps } from '@mad/schema';
import { chartBars, chartDonut, chartLayers, sparklinePoints, CHART_H, CHART_W } from './chart-geometry';
import { cellFor, chatThread, hashSeed, initials, personName, rng, taskCard } from './fake-data';
import { attrs, classes, el, esc, styleAttr } from './html';
import { BUTTON_ICON_MAP, EXPORT_ICONS, iconSvg, type ExportIconName } from './icons';
import { RENDERER_CSS } from './renderer.css';
import { RUNTIME_JS } from './runtime.js.gen';

/**
 * Static HTML renderer for MadDocuments.
 *
 * It shares the studio canvas's class vocabulary and inline-style mapping
 * (apps/web/src/app/core/render/node-view.component.html) so a deployed page
 * looks like the preview the user approved. It deliberately does NOT share the
 * canvas's element vocabulary: the canvas is an editor, where a live `<button>`
 * would swallow the click that selects a node, so it draws controls as inert
 * spans. A deployed page is the running application, so it emits real buttons,
 * inputs, selects, checkboxes and tabs, and ships the runtime in `runtime.ts`
 * that gives them behaviour.
 *
 * Output stays a single self-contained document: inline CSS, inline SVG, inline
 * script, no runtime dependencies beyond web fonts.
 */

const str = (v: PropValue | undefined, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);
const num = (v: PropValue | undefined, fallback: number): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : fallback);
const bool = (v: PropValue | undefined, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const list = (v: PropValue | undefined): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

const widthFor = (w: NonNullable<StyleProps['width']>): string => (w === 'full' ? '100%' : w === 'content' ? 'max-content' : w === 'auto' ? 'auto' : `calc(${w} * 100%)`);
const alignFor = (a: NonNullable<StyleProps['align']>): string => (a === 'start' ? 'flex-start' : a === 'end' ? 'flex-end' : a);
const justifyFor = (j: NonNullable<StyleProps['justify']>): string => (j === 'between' ? 'space-between' : j === 'start' ? 'flex-start' : j === 'end' ? 'flex-end' : j);

/** Host element inline style, identical to NodeView.hostStyle. */
export const hostStyle = (s: StyleProps): string => {
  const out: Record<string, string> = {};
  if (s.padding) out['padding'] = `${s.padding.top}px ${s.padding.right}px ${s.padding.bottom}px ${s.padding.left}px`;
  if (s.margin) out['margin'] = `${s.margin.top}px ${s.margin.right}px ${s.margin.bottom}px ${s.margin.left}px`;
  if (s.gap !== undefined) out['--r-gap'] = `${s.gap}px`;
  if (s.radius !== undefined) out['--r-radius'] = `${s.radius}px`;
  if (s.background) out['--r-bg-override'] = s.background;
  if (s.foreground) out['color'] = s.foreground;
  if (s.columns) out['--r-cols'] = String(s.columns);
  if (s.width) out['--r-width'] = widthFor(s.width);
  if (s.align) out['--r-align'] = alignFor(s.align);
  if (s.justify) out['--r-justify'] = justifyFor(s.justify);
  if (s.direction) out['--r-direction'] = s.direction;
  if (s.border !== undefined) out['--r-border-w'] = s.border ? '1px' : '0px';
  if (s.shadow) out['--r-shadow'] = `var(--r-shadow-${s.shadow})`;
  return styleAttr(out);
};

const children = (nodes: MadNode[]): string => el('div', { class: 'r-children' }, nodes.map((c) => renderNodeHtml(c)));

/** Per-node id for a control, so labels, panels and tabs can point at each other. */
const uid = (node: MadNode, suffix: string): string => `${node.id}-${suffix}`;

const SUCCESS = ['Active', 'Synced', 'Published', 'Paid', 'Shipped', 'Resolved'];
const DANGER = ['Past due', 'Churn risk', 'Failed', 'Blocked', 'Cancelled'];
const WARNING = ['Trial', 'Pending', 'Scheduled', 'Review', 'On hold'];

/** Shared with the canvas, so a status badge is the same colour in the preview and the deployed page. */
export const statusTone = (cell: string): string => (SUCCESS.indexOf(cell) >= 0 ? 'success' : DANGER.indexOf(cell) >= 0 ? 'danger' : WARNING.indexOf(cell) >= 0 ? 'warning' : 'neutral');

const badge = (text: string, tone: string, inline = false): string => el('span', { class: classes('r-badge', inline && 'r-badge-inline'), 'data-tone': tone }, esc(text));

/** A real button. `extra` carries size/width modifiers, `more` any behaviour hooks. */
const btn = (label: string, variant: string, extra: string[] = [], icon: ExportIconName | null = null, more: Record<string, string | boolean> = {}): string =>
  el('button', { type: 'button', class: classes('r-btn', `r-btn-${variant}`, ...extra), ...more }, `${icon ? iconSvg(icon, 14) : ''}${esc(label)}`);

const iconBtn = (icon: ExportIconName, label: string, more: Record<string, string | boolean> = {}): string =>
  el('button', { type: 'button', class: 'r-icon-btn', 'aria-label': label, ...more }, iconSvg(icon, 14));

const renderChart = (node: MadNode): string => {
  const p = node.props;
  const kind = str(p['kind'], 'line');
  const labels = list(p['series']).length ? list(p['series']) : ['Series'];
  const points = num(p['points'], 12);
  const title = str(p['title'], 'Chart');
  if (kind === 'donut') {
    const segs = chartDonut(node.id, labels);
    return el('div', { class: 'r-chart-svg' }, [
      el('div', { class: 'r-donut' }, [
        el(
          'svg',
          { viewBox: '0 0 120 120', role: 'img', 'aria-label': `${title}: ${segs.map((s) => `${s.label} ${s.pct}%`).join(', ')}` },
          segs.map((s) => `<circle cx="60" cy="60" r="46" fill="none" stroke="${esc(s.color)}" stroke-width="16" stroke-dasharray="${esc(s.dash)}" stroke-dashoffset="${esc(s.offset)}"><title>${esc(s.label)}: ${s.pct}%</title></circle>`),
        ),
        el(
          'ul',
          { class: 'r-donut-list' },
          segs.map((s) => el('li', {}, [`<i style="background:${esc(s.color)}"></i>`, el('span', {}, esc(s.label)), el('b', {}, `${s.pct}%`)])),
        ),
      ]),
    ]);
  }
  const layers = chartLayers(node.id, labels, points);
  const gid = hashSeed(node.id).toString(36);
  const grid = [0.25, 0.5, 0.75].map((y) => `<line x1="0" y1="${CHART_H * y}" x2="${CHART_W}" y2="${CHART_H * y}" stroke="var(--r-line)" stroke-dasharray="2 4"/>`).join('');
  let body: string;
  if (kind === 'bar') {
    body = chartBars(node.id, points, labels.length)
      .map(
        (b, i) =>
          `<rect x="${b.x.toFixed(2)}" y="${b.y.toFixed(2)}" width="${b.w.toFixed(2)}" height="${b.h.toFixed(2)}" fill="${esc(b.color)}" rx="2" class="bar" style="--i:${i}" data-series="${b.series}"><title>${esc(labels[b.series] ?? '')}: ${Math.round(b.value * 100)}</title></rect>`,
      )
      .join('');
  } else {
    const defs = layers
      .map((l, i) => `<linearGradient id="g${gid}${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${esc(l.color)}" stop-opacity="0.35"/><stop offset="1" stop-color="${esc(l.color)}" stop-opacity="0"/></linearGradient>`)
      .join('');
    body =
      `<defs>${defs}</defs>` +
      layers
        .map(
          (l, i) =>
            `<g data-series="${i}">${kind === 'area' ? `<path d="${esc(l.area)}" fill="url(#g${gid}${i})"/>` : ''}<path d="${esc(l.path)}" fill="none" stroke="${esc(l.color)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" class="line"><title>${esc(labels[i] ?? '')}</title></path></g>`,
        )
        .join('');
  }
  // Legend entries toggle their series, so a busy chart can be read one line at a time.
  const legend = el(
    'div',
    { class: 'r-chart-legend' },
    layers.map((l, i) => el('button', { type: 'button', class: 'r-legend-item', 'data-series': String(i), 'aria-pressed': 'true' }, `<i style="background:${esc(l.color)}"></i>${esc(labels[i] ?? '')}`)),
  );
  return el('div', { class: 'r-chart-svg' }, [
    `<svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}">${grid}${body}</svg>`,
    legend,
  ]);
};

/** A labelled field wrapper. The control is a sibling of the label, so `for` can bind them. */
const field = (id: string, labelText: string, control: string, helper: string, required: boolean): string =>
  el('div', { class: 'r-field' }, [
    labelText ? el('label', { class: 'r-label', for: id }, `${esc(labelText)}${required ? '<span class="r-required" aria-hidden="true">*</span>' : ''}`) : '',
    control,
    helper ? el('span', { class: 'r-helper', id: `${id}-helper` }, esc(helper)) : '',
    el('span', { class: 'r-error', id: `${id}-error`, role: 'alert', hidden: true }, ''),
  ]);

const renderInner = (n: MadNode): string => {
  const p = n.props;
  const seed = hashSeed(n.id);
  switch (n.type) {
    case 'page':
      return el('div', { class: 'r-page', 'data-layout': str(p['layout'], 'app-shell') }, children(n.children));

    case 'nav': {
      const links = list(p['links']).map((l, i) =>
        el('button', { type: 'button', class: classes('r-nav-link', i === 0 && 'is-active'), 'data-nav': esc(l), 'aria-current': i === 0 ? 'page' : false }, esc(l)),
      );
      const avatarName = str(p['name']) || personName(rng(seed));
      const r = rng(seed);
      const notices = [taskCard(r), taskCard(r), taskCard(r)];
      return el('header', { class: classes('r-nav', bool(p['sticky'], true) && 'r-nav-sticky') }, [
        el('span', { class: 'r-brand' }, `<span class="r-brand-mark"></span>${esc(str(p['brand'], 'Brand'))}`),
        el('nav', { class: 'r-nav-links', 'aria-label': 'Sections' }, links),
        el('span', { class: 'r-nav-end' }, [
          el('span', { class: 'r-search-wrap' }, [
            iconBtn('search', 'Search this page', { 'data-action': 'search-toggle', 'aria-expanded': 'false', 'aria-controls': uid(n, 'search') }),
            el('input', { type: 'search', class: 'r-nav-search', id: uid(n, 'search'), placeholder: 'Filter rows and cards…', 'aria-label': 'Filter rows and cards', hidden: true }),
          ]),
          el('span', { class: 'r-popover-wrap' }, [
            iconBtn('bell', 'Notifications', { 'data-action': 'notifications', 'aria-expanded': 'false', 'aria-controls': uid(n, 'notices') }),
            el(
              'div',
              { class: 'r-popover', id: uid(n, 'notices'), role: 'group', 'aria-label': 'Notifications', hidden: true },
              [el('span', { class: 'r-popover-title' }, 'Recent activity')].concat(
                notices.map((t) => el('span', { class: 'r-popover-item' }, [el('span', { class: 'r-popover-tag' }, esc(t.tag)), el('span', {}, esc(t.title))])),
              ),
            ),
          ]),
          str(p['cta']) ? btn(str(p['cta']), 'primary', ['r-btn-sm']) : '',
          el('span', { class: 'r-avatar r-avatar-sm' }, esc(initials(avatarName))),
        ]),
      ]);
    }

    case 'sidebar': {
      const active = num(p['active'], 0);
      const items = list(p['items']);
      return el('aside', { class: 'r-sidebar' }, [
        el('span', { class: 'r-sidebar-label' }, 'Workspace'),
        el(
          'nav',
          { class: 'r-sidebar-nav', 'aria-label': 'Workspace' },
          items
            .map((item, i) =>
              el(
                'button',
                { type: 'button', class: classes('r-sidebar-item', i === active && 'is-active'), 'data-nav': esc(item), 'aria-current': i === active ? 'page' : false },
                `<span class="r-sidebar-dot"></span>${esc(item)}`,
              ),
            )
            .concat([
              '<span class="r-sidebar-spacer"></span>',
              el('button', { type: 'button', class: 'r-sidebar-item', 'data-nav': 'Settings' }, '<span class="r-sidebar-dot"></span>Settings'),
            ]),
        ),
      ]);
    }

    case 'section': {
      const eyebrow = str(p['eyebrow']);
      const title = str(p['title']);
      const subtitle = str(p['subtitle']);
      const head =
        eyebrow || title || subtitle
          ? el('header', { class: 'r-section-head' }, [
              eyebrow ? el('span', { class: 'r-eyebrow' }, esc(eyebrow)) : '',
              title ? el('h2', { class: 'r-section-title', id: uid(n, 'title') }, esc(title)) : '',
              subtitle ? el('p', { class: 'r-section-subtitle' }, esc(subtitle)) : '',
            ])
          : '';
      return el('section', { class: 'r-section', ...(title ? { 'aria-labelledby': uid(n, 'title'), 'data-section': title } : {}) }, [head, children(n.children)]);
    }

    case 'stack':
      return el('div', { class: 'r-stack' }, children(n.children));

    case 'grid':
      return el('div', { class: 'r-grid' }, children(n.children));

    case 'card': {
      const title = str(p['title']);
      const subtitle = str(p['subtitle']);
      const head =
        title || subtitle
          ? el('div', { class: 'r-card-head' }, el('div', {}, [title ? el('h3', { class: 'r-card-title' }, esc(title)) : '', subtitle ? el('p', { class: 'r-card-subtitle' }, esc(subtitle)) : '']))
          : '';
      return el('div', { class: classes('r-card', bool(p['interactive']) && 'r-card-interactive') }, [head, el('div', { class: 'r-body' }, children(n.children))]);
    }

    case 'form':
      return el('form', { class: 'r-form', 'data-layout': str(p['layout'], 'two-column'), novalidate: true }, [
        str(p['title']) ? el('h3', { class: 'r-card-title' }, esc(str(p['title']))) : '',
        el('div', { class: 'r-body' }, children(n.children)),
        el('p', { class: 'r-form-status', role: 'status', 'aria-live': 'polite' }, ''),
        el('div', { class: 'r-form-actions' }, [
          el('button', { type: 'reset', class: 'r-btn r-btn-ghost' }, 'Cancel'),
          el('button', { type: 'submit', class: 'r-btn r-btn-primary' }, esc(str(p['submitLabel'], 'Save'))),
        ]),
      ]);

    case 'tabs': {
      const active = num(p['active'], 0);
      const named = list(p['tabs']);
      // Pair each tab with a panel. A label with nothing behind it would be a
      // dead end, and a panel with no label would be unreachable, so the count
      // is whichever list is shorter, with generated names filling any gap.
      // A tab strip with nothing nested under it is a toolbar filter over the
      // section it sits in, which is how the planner uses it: "All / Drafts /
      // Scheduled" are states of one table, not three separate views. Rendering
      // it as a tablist would promise panels that do not exist, so it becomes a
      // radio group and the runtime narrows the section's rows and cards.
      if (n.children.length === 0) {
        const filters = named.length ? named : ['All'];
        const chosen = Math.min(Math.max(0, active), filters.length - 1);
        return el('div', { class: 'r-tabs r-tabs-filter' }, [
          el(
            'div',
            { class: 'r-tablist', role: 'radiogroup', 'aria-label': str(p['label'], 'Filter') },
            filters.map((t, i) =>
              el(
                'button',
                { type: 'button', class: classes('r-tab', i === chosen && 'is-active'), role: 'radio', 'aria-checked': i === chosen ? 'true' : 'false', tabindex: i === chosen ? 0 : -1, 'data-filter': esc(t) },
                esc(t),
              ),
            ),
          ),
        ]);
      }
      const labels = n.children.map((_, i) => named[i] ?? `View ${i + 1}`);
      const current = Math.min(Math.max(0, active), labels.length - 1);
      // Every panel ships, hidden until selected, so switching needs no round trip.
      return el('div', { class: 'r-tabs' }, [
        el(
          'div',
          { class: 'r-tablist', role: 'tablist', 'aria-label': 'Views' },
          labels.map((t, i) =>
            el(
              'button',
              {
                type: 'button',
                class: classes('r-tab', i === current && 'is-active'),
                role: 'tab',
                id: uid(n, `tab-${i}`),
                'aria-controls': uid(n, `panel-${i}`),
                'aria-selected': i === current ? 'true' : 'false',
                tabindex: i === current ? 0 : -1,
              },
              esc(t),
            ),
          ),
        ),
        ...labels.map((_, i) =>
          el(
            'div',
            { class: 'r-tabpanel', role: 'tabpanel', id: uid(n, `panel-${i}`), 'aria-labelledby': uid(n, `tab-${i}`), tabindex: 0, hidden: i !== current },
            renderNodeHtml(n.children[i] as MadNode),
          ),
        ),
      ]);
    }

    case 'heading': {
      const level = Math.min(4, Math.max(1, num(p['level'], 2)));
      return el(`h${level}`, { class: `r-heading r-h${level}`, 'data-weight': str(p['weight'], 'semibold') }, esc(str(p['text'], 'Heading')));
    }

    case 'text':
      return el('p', { class: 'r-text', 'data-tone': str(p['tone'], 'default'), 'data-size': str(p['size'], 'md') }, esc(str(p['text'], 'Text')));

    case 'button': {
      const variant = str(p['variant'], 'primary');
      const raw = str(p['icon']);
      const icon: ExportIconName | null = raw in BUTTON_ICON_MAP ? (BUTTON_ICON_MAP[raw] as ExportIconName) : raw in EXPORT_ICONS ? (raw as ExportIconName) : null;
      // `is-disabled` keeps the existing styling; the attribute is what actually blocks the click.
      const extra = [str(p['size']) === 'sm' && 'r-btn-sm', str(p['size']) === 'lg' && 'r-btn-lg', bool(p['fullWidth']) && 'r-btn-full', bool(p['disabled']) && 'is-disabled'].filter(
        (x): x is string => typeof x === 'string',
      );
      return btn(str(p['label'], 'Button'), ['primary', 'secondary', 'ghost', 'danger'].includes(variant) ? variant : 'primary', extra, icon, bool(p['disabled']) ? { disabled: true } : {});
    }

    case 'input': {
      const label = str(p['label']);
      const type = str(p['inputType'], 'text');
      const id = uid(n, 'c');
      const helper = str(p['helper']);
      const required = bool(p['required']);
      const common = {
        class: 'r-input',
        id,
        placeholder: str(p['placeholder'], 'Enter a value'),
        ...(required ? { required: true } : {}),
        ...(helper ? { 'aria-describedby': `${id}-helper` } : {}),
        ...(label ? {} : { 'aria-label': str(p['placeholder'], 'Enter a value') }),
      };
      const control =
        type === 'textarea'
          ? el('textarea', { ...common, rows: 3, 'data-type': 'textarea' }, '')
          : type === 'search'
            ? el('span', { class: 'r-input-wrap', 'data-type': 'search' }, [iconSvg('search', 14), el('input', { ...common, type: 'search' }, '')])
            : el('input', { ...common, type: ['text', 'email', 'password', 'number', 'tel', 'url', 'date'].includes(type) ? type : 'text', 'data-type': type }, '');
      return field(id, label, control, helper, required);
    }

    case 'select': {
      const id = uid(n, 'c');
      const options = list(p['options']).length ? list(p['options']) : ['Option A', 'Option B'];
      return field(
        id,
        str(p['label']),
        el('span', { class: 'r-input-wrap', 'data-type': 'select' }, [
          el(
            'select',
            { class: 'r-input r-select', id, ...(str(p['label']) ? {} : { 'aria-label': 'Select an option' }) },
            options.map((o, i) => el('option', { value: esc(o), selected: i === 0 }, esc(o))),
          ),
          iconSvg('chevron-down', 14),
        ]),
        str(p['helper']),
        bool(p['required']),
      );
    }

    case 'toggle': {
      const id = uid(n, 'c');
      const on = bool(p['checked']);
      return el('span', { class: classes('r-toggle', on && 'is-on') }, [
        el('label', { class: 'r-toggle-label', for: id }, esc(str(p['label'], 'Toggle'))),
        el('button', { type: 'button', class: 'r-switch', id, role: 'switch', 'aria-checked': on ? 'true' : 'false' }, '<span class="r-knob"></span>'),
      ]);
    }

    case 'badge':
      return badge(str(p['text'], 'Badge'), str(p['tone'], 'neutral'));

    case 'avatar': {
      const name = str(p['name']) || personName(rng(seed));
      return el('span', { class: 'r-avatar-row' }, [
        el('span', { class: 'r-avatar', 'data-size': str(p['size'], 'md') }, `${esc(initials(name))}${bool(p['status'], true) ? '<span class="r-status"></span>' : ''}`),
        el('span', { class: 'r-avatar-name' }, esc(name)),
      ]);
    }

    case 'divider':
      return el('span', { class: 'r-divider' }, str(p['label']) ? el('span', {}, esc(str(p['label']))) : '');

    case 'image':
      return el('span', { class: 'r-image', style: `aspect-ratio:${esc(str(p['ratio'], '16/9'))}`, role: 'img', 'aria-label': str(p['alt'], 'Image') }, iconSvg('image', 22));

    case 'stat': {
      const trend = str(p['trend'], 'up');
      const delta = str(p['delta']);
      return el('div', { class: 'r-stat' }, [
        el('span', { class: 'r-stat-label' }, esc(str(p['label'], 'Metric'))),
        el('span', { class: 'r-stat-row' }, [
          el('span', { class: 'r-stat-value' }, esc(str(p['value'], '0'))),
          bool(p['sparkline'], true)
            ? `<svg class="r-spark" viewBox="0 0 72 22" preserveAspectRatio="none" aria-hidden="true"><polyline points="${esc(sparklinePoints(n.id, trend))}" fill="none" stroke="${trend === 'down' ? 'var(--r-danger)' : 'var(--r-success)'}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`
            : '',
        ]),
        delta ? el('span', { class: 'r-delta', 'data-trend': trend }, `${iconSvg(trend === 'down' ? 'trending-down' : trend === 'flat' ? 'minus' : 'trending-up', 12)}${esc(delta)}`) : '',
      ]);
    }

    case 'chart':
      return el('div', { class: 'r-chart' }, [str(p['title']) ? el('span', { class: 'r-chart-title' }, esc(str(p['title']))) : '', renderChart(n)]);

    case 'table': {
      const r = rng(seed);
      const cols = list(p['columns']).length ? list(p['columns']) : ['Name', 'Status', 'Updated'];
      const rowsN = Math.min(50, Math.max(1, num(p['rows'], 6)));
      const statuses = list(p['statuses']);
      const rows = Array.from({ length: rowsN }, (_, i) => cols.map((c) => cellFor(c, r, i, statuses)));
      const selectable = bool(p['selectable']);
      const title = str(p['title']);
      return el('div', { class: 'r-table-wrap' }, [
        title
          ? el('div', { class: 'r-table-head' }, [
              el('span', { class: 'r-card-title' }, esc(title)),
              el('span', { class: 'r-table-count', role: 'status', 'aria-live': 'polite' }, `${rows.length} rows`),
            ])
          : el('div', { class: 'r-table-head r-table-head-bare' }, el('span', { class: 'r-table-count', role: 'status', 'aria-live': 'polite' }, `${rows.length} rows`)),
        el('table', { class: classes('r-table', bool(p['striped']) && 'is-striped') }, [
          el(
            'thead',
            {},
            el('tr', {}, [
              selectable
                ? el('th', { class: 'r-th-check', scope: 'col' }, el('input', { type: 'checkbox', class: 'r-check', 'data-role': 'select-all', 'aria-label': 'Select all rows' }, ''))
                : '',
              // Every column sorts. `aria-sort` on the header is what a screen reader reads back.
              ...cols.map((c) => el('th', { scope: 'col', 'aria-sort': 'none' }, el('button', { type: 'button', class: 'r-th-sort' }, `${esc(c)}${iconSvg('chevron-down', 12)}`))),
            ]),
          ),
          el(
            'tbody',
            {},
            rows.map((row, ri) =>
              el('tr', {}, [
                selectable ? el('td', { class: 'r-th-check' }, el('input', { type: 'checkbox', class: 'r-check', 'aria-label': `Select row ${ri + 1}` }, '')) : '',
                ...row.map((cell, ci) => el('td', {}, (cols[ci] ?? '').toLowerCase().includes('status') ? badge(cell, statusTone(cell), true) : esc(cell))),
              ]),
            ),
          ),
        ]),
        el('p', { class: 'r-empty-state', hidden: true }, 'No rows match your filter.'),
      ]);
    }

    case 'list': {
      const items = list(p['items']);
      return bool(p['ordered'])
        ? el('ol', { class: 'r-list r-list-ordered' }, items.map((i) => el('li', {}, esc(i))))
        : el('ul', { class: 'r-list' }, items.map((i) => el('li', {}, `<span class="r-list-dot"></span>${esc(i)}`)));
    }

    case 'kanban': {
      const r = rng(seed);
      const cols = list(p['columns']).length ? list(p['columns']) : ['Todo', 'Doing', 'Done'];
      const per = Math.min(8, Math.max(1, num(p['cardsPerColumn'], 3)));
      // A planned app supplies its own vocabulary; anything else falls back to the generic set.
      const planned = list(p['cards']);
      let next = 0;
      return el(
        'div',
        { class: 'r-kanban' },
        cols.map((title, ci) => {
          const cards = Array.from({ length: Math.max(1, per - (ci % 2)) }, () => {
            const generated = taskCard(r);
            if (planned.length === 0) return generated;
            const label = planned[next % planned.length] as string;
            next += 1;
            return { ...generated, title: label };
          });
          return el('div', { class: 'r-kanban-col', 'data-column': esc(title) }, [
            el('span', { class: 'r-kanban-head' }, `${esc(title)}<span class="r-kanban-count">${cards.length}</span>`),
            el(
              'ul',
              { class: 'r-kanban-cards', 'aria-label': `${esc(title)} cards` },
              cards.map((c) =>
                el(
                  'li',
                  {},
                  el('button', { type: 'button', class: 'r-kanban-card', draggable: 'true' }, [
                    el('span', { class: 'r-kanban-tag' }, esc(c.tag)),
                    el('span', { class: 'r-kanban-title' }, esc(c.title)),
                    el('span', { class: 'r-kanban-meta' }, [
                      el('span', { class: 'r-avatar r-avatar-xs' }, esc(initials(c.assignee))),
                      badge(c.priority, c.priority === 'P0' ? 'danger' : c.priority === 'P1' ? 'warning' : 'neutral', true),
                    ]),
                  ]),
                ),
              ),
            ),
          ]);
        }),
      );
    }

    case 'chat': {
      const thread = chatThread(rng(seed), str(p['agentName'], 'Agent'));
      const first = thread[0];
      const id = uid(n, 'c');
      return el('div', { class: 'r-chat' }, [
        el('div', { class: 'r-chat-head' }, [
          el('span', { class: 'r-avatar r-avatar-sm' }, esc(initials(first?.name ?? 'C'))),
          el('span', { class: 'r-chat-who' }, [
            el('span', { class: 'r-chat-name' }, esc(first?.name ?? '')),
            bool(p['showStatus'], true) ? el('span', { class: 'r-chat-status' }, `<span class="r-online"></span>Online · replied ${esc(thread[2]?.time ?? '')}`) : '',
          ]),
          iconBtn('info', 'Conversation details'),
        ]),
        el(
          'div',
          { class: 'r-chat-body', role: 'log', 'aria-label': 'Conversation', 'aria-live': 'polite' },
          thread.map((m) => el('div', { class: 'r-msg', 'data-from': m.from }, [el('span', { class: 'r-msg-bubble' }, esc(m.text)), el('span', { class: 'r-msg-meta' }, `${m.from === 'agent' ? esc(m.name) : ''} ${esc(m.time)}`)])),
        ),
        el('form', { class: 'r-chat-composer' }, [
          el('input', { type: 'text', class: 'r-chat-input', id, placeholder: str(p['placeholder'], 'Type a reply…'), 'aria-label': 'Message', autocomplete: 'off' }, ''),
          el('button', { type: 'submit', class: 'r-btn r-btn-primary r-btn-sm', 'aria-label': 'Send message' }, iconSvg('arrow-right', 14)),
        ]),
      ]);
    }

    case 'timeline':
      return el(
        'ol',
        { class: 'r-timeline' },
        list(p['events']).map((e, i) =>
          el('li', {}, [el('span', { class: classes('r-tl-dot', i === 0 && 'is-live') }, ''), el('span', { class: 'r-tl-text' }, esc(e)), el('span', { class: 'r-tl-time' }, i === 0 ? 'just now' : `${i * 12}m ago`)]),
        ),
      );

    case 'pricing': {
      const tiers = list(p['tiers']);
      const names = tiers.length ? tiers : ['Starter', 'Growth', 'Scale'];
      const yearly = str(p['billing'], 'monthly') === 'yearly';
      const prices = [0, 29, 99, 249];
      const features = [
        ['1 project', 'Community support', 'Preview deploys'],
        ['Unlimited projects', 'Custom domains', 'Email support', 'Team of 5'],
        ['Everything in Growth', 'SSO and audit logs', 'Priority support', 'Unlimited seats'],
        ['Dedicated infrastructure', 'SLA', 'Solutions engineer'],
      ];
      const highlight = num(p['highlight'], 1);
      return el(
        'div',
        { class: 'r-pricing', role: 'radiogroup', 'aria-label': 'Plans' },
        names.slice(0, 4).map((name, i) => {
          const price = prices[i] ?? 0;
          const isHi = i === highlight;
          return el('div', { class: classes('r-price-card', isHi && 'is-highlight') }, [
            isHi ? badge('Most popular', 'info', true) : '',
            el('span', { class: 'r-price-name' }, esc(name)),
            el('span', { class: 'r-price' }, [el('span', { class: 'r-price-amount' }, price === 0 ? 'Free' : `$${yearly ? Math.round(price * 10) : price}`), el('span', { class: 'r-price-period' }, price === 0 ? '' : yearly ? '/yr' : '/mo')]),
            el('ul', { class: 'r-list r-price-features' }, (features[i] ?? []).map((f) => el('li', {}, `${iconSvg('check', 12)}${esc(f)}`))),
            el('button', { type: 'button', class: classes('r-btn', isHi ? 'r-btn-primary' : 'r-btn-secondary'), 'data-plan': esc(name), role: 'radio', 'aria-checked': 'false' }, `Choose ${esc(name)}`),
          ]);
        }),
      );
    }

    default:
      return '';
  }
};

/** One node and its subtree as HTML, wrapped in the `.r-node` host the stylesheet targets. */
export const renderNodeHtml = (node: MadNode): string =>
  el('div', { class: classes('r-node', node.style.hidden === true && 'r-hidden'), 'data-node-type': node.type, 'data-node-id': node.id, style: hostStyle(node.style) || undefined }, renderInner(node));

export interface RenderOptions {
  /** Page <title>. */
  title: string;
  description?: string;
  target: 'preview' | 'production';
  version: number;
  deployedAt: string;
  deploymentId: string;
  /** Link for the "Built with MAD Studio" badge; omit to hide the badge. */
  studioUrl?: string;
  /** Load the renderer's web fonts from Google Fonts (default true). */
  fonts?: boolean;
  /** Ship the behaviour runtime (default true). Off produces the old static page. */
  interactive?: boolean;
}

const FONT_HREF: Record<DesignSystem, string> = {
  tailwind: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Bricolage+Grotesque:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
  material: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap',
  wordpress: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
};

/** Switches the renderer's device rules by viewport width so the export is responsive with the canvas's own breakpoints. */
const DEVICE_SCRIPT =
  "(function(){var f=document.querySelector('.r-frame');if(!f)return;function u(){var w=window.innerWidth;f.setAttribute('data-device',w<720?'iphone':w<1100?'tablet':'desktop')}u();window.addEventListener('resize',u,{passive:true})})();";

/** A complete, standalone HTML page for the document. */
export const renderDocumentHtml = (document: MadDocument, options: RenderOptions): string => {
  const fonts = options.fonts !== false;
  const interactive = options.interactive !== false;
  const badgeHtml = options.studioUrl
    ? el('a', { class: 'mad-badge', href: options.studioUrl, target: '_blank', rel: 'noopener' }, '<i></i>Built with MAD Studio')
    : '';
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(options.title)}</title>`,
    options.description ? `<meta name="description" content="${esc(options.description)}">` : '',
    options.target === 'preview' ? '<meta name="robots" content="noindex">' : '',
    '<meta name="generator" content="MAD Studio">',
    `<meta name="mad:deployment" content="${esc(options.deploymentId)}">`,
    `<meta name="theme-color" content="${document.theme === 'light' ? '#f4f6f9' : '#0d1016'}">`,
    fonts ? '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' : '',
    fonts ? `<link rel="stylesheet" href="${FONT_HREF[document.designSystem]}">` : '',
    `<style>${RENDERER_CSS}</style>`,
  ]
    .filter(Boolean)
    .join('\n');
  const frame = el(
    'div',
    {
      class: 'r-frame',
      'data-ds': document.designSystem,
      'data-rtheme': document.theme,
      'data-device': 'desktop',
      'data-mad-deployment': options.deploymentId,
      'data-mad-version': String(options.version),
      'data-mad-target': options.target,
    },
    renderNodeHtml(document.root),
  );
  const scripts = `<script>${DEVICE_SCRIPT}</script>${interactive ? `\n<script>${RUNTIME_JS}</script>` : ''}`;
  return `<!doctype html>\n<html lang="en"${attrs({ 'data-theme': document.theme })}>\n<head>\n${head}\n</head>\n<body>\n${frame}\n${badgeHtml}\n${scripts}\n<!-- Deployed ${esc(options.deployedAt)} · v${options.version} · ${options.target} -->\n</body>\n</html>\n`;
};

export interface DeployManifest {
  generator: 'mad-studio';
  deploymentId: string;
  target: 'preview' | 'production';
  version: number;
  deployedAt: string;
  title: string;
  designSystem: DesignSystem;
  theme: 'dark' | 'light';
  nodeCount: number;
  tables: string[];
  integrations: string[];
}

const countNodes = (node: MadNode): number => 1 + node.children.reduce((n, c) => n + countNodes(c), 0);

export const buildManifest = (document: MadDocument, options: RenderOptions): DeployManifest => ({
  generator: 'mad-studio',
  deploymentId: options.deploymentId,
  target: options.target,
  version: options.version,
  deployedAt: options.deployedAt,
  title: options.title,
  designSystem: document.designSystem,
  theme: document.theme,
  nodeCount: countNodes(document.root),
  tables: document.tables.map((t) => t.table),
  integrations: [...document.integrations],
});
