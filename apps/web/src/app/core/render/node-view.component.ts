import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { MadNode, NodeId, PropValue, StyleProps } from '@mad/schema';
import { isContainer } from '@mad/schema';
import { Icon, type IconName, ICONS } from '../ui/icon.component';
import { Chart } from './chart.component';
import { RenderContext } from './render-context';
import { sparklinePoints } from '@mad/export';
import { cellFor, chatThread, hashSeed, initials, personName, rng, taskCard } from './fake-data';

const str = (v: PropValue | undefined, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);
const num = (v: PropValue | undefined, fallback: number): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : fallback);
const bool = (v: PropValue | undefined, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const list = (v: PropValue | undefined): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : String(x))) : []);

/**
 * Recursive renderer for MadNode trees. One component handles every node type
 * so the tree renders as a single DOM pass; selection, hover and drop targets
 * are wired through RenderContext so the same renderer serves the studio
 * canvas (interactive) and the landing-page demo (read-only).
 */
@Component({
  selector: 'mad-node',
  imports: [NgTemplateOutlet, Icon, Chart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './node-view.component.html',
  styleUrl: './node-view.component.css',
  host: {
    class: 'r-node',
    '[class.r-hidden]': 'node().style.hidden === true',
    '[class.is-selected]': 'selected()',
    '[class.is-hovered]': 'hovered()',
    '[class.is-dropping]': 'dropping()',
    '[class.is-interactive]': 'ctx.interactive()',
    '[class.is-entering]': 'entering()',
    '[attr.data-node-id]': 'node().id',
    '[attr.data-node-type]': 'node().type',
    '[attr.role]': "ctx.interactive() ? 'button' : null",
    '[attr.tabindex]': 'ctx.interactive() ? 0 : null',
    '[attr.aria-label]': "ctx.interactive() ? 'Select ' + node().name + ' (' + node().type + ')' : null",
    '[attr.aria-pressed]': 'ctx.interactive() ? selected() : null',
    '[style]': 'hostStyle()',
    '(click)': 'onClick($event)',
    '(keydown.enter)': 'onClick($event)',
    '(pointerenter)': 'onEnter($event)',
    '(pointerleave)': 'onLeave($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
})
export class NodeView {
  readonly node = input.required<MadNode>();
  readonly depth = input<number>(0);

  protected readonly ctx = inject(RenderContext);

  protected readonly selected = computed(() => this.ctx.selectedId() === this.node().id);
  protected readonly hovered = computed(() => this.ctx.hoveredId() === this.node().id);
  protected readonly dropping = computed(() => this.ctx.dropTargetId() === this.node().id);
  protected readonly entering = computed(() => this.ctx.enteringIds().has(this.node().id));
  protected readonly isContainer = computed(() => isContainer(this.node().type));
  protected readonly p = computed(() => this.node().props);
  protected readonly s = computed<StyleProps>(() => this.node().style);
  protected readonly seed = computed(() => hashSeed(this.node().id));

  protected readonly hostStyle = computed(() => {
    const s = this.s();
    const out: Record<string, string> = {};
    if (s.padding) out['padding'] = `${s.padding.top}px ${s.padding.right}px ${s.padding.bottom}px ${s.padding.left}px`;
    if (s.margin) out['margin'] = `${s.margin.top}px ${s.margin.right}px ${s.margin.bottom}px ${s.margin.left}px`;
    if (s.gap !== undefined) out['--r-gap'] = `${s.gap}px`;
    if (s.radius !== undefined) out['--r-radius'] = `${s.radius}px`;
    if (s.background) out['--r-bg-override'] = s.background;
    if (s.foreground) out['color'] = s.foreground;
    if (s.columns) out['--r-cols'] = String(s.columns);
    if (s.width) out['--r-width'] = this.widthFor(s.width);
    if (s.align) out['--r-align'] = this.alignFor(s.align);
    if (s.justify) out['--r-justify'] = this.justifyFor(s.justify);
    if (s.direction) out['--r-direction'] = s.direction;
    if (s.border !== undefined) out['--r-border-w'] = s.border ? '1px' : '0px';
    if (s.shadow) out['--r-shadow'] = `var(--r-shadow-${s.shadow})`;
    return out;
  });

  // ---- text helpers exposed to the template ----
  protected str = str;
  protected num = num;
  protected bool = bool;
  protected list = list;
  protected initials = initials;

  protected readonly headingTag = computed(() => `h${Math.min(4, Math.max(1, num(this.p()['level'], 2)))}`);
  protected readonly navLinks = computed(() => list(this.p()['links']));
  protected readonly sidebarItems = computed(() => list(this.p()['items']));
  protected readonly tabLabels = computed(() => list(this.p()['tabs']));
  protected readonly activeIndex = computed(() => num(this.p()['active'], 0));
  protected readonly listItems = computed(() => list(this.p()['items']));
  protected readonly timelineEvents = computed(() => list(this.p()['events']));
  protected readonly options = computed(() => list(this.p()['options']));
  protected readonly chartSeries = computed(() => {
    const s = list(this.p()['series']);
    return s.length ? s : ['Series'];
  });

  protected readonly tableColumns = computed(() => {
    const cols = list(this.p()['columns']);
    return cols.length ? cols : ['Name', 'Status', 'Updated'];
  });
  protected readonly tableRows = computed(() => {
    const r = rng(this.seed());
    const n = Math.min(50, Math.max(1, num(this.p()['rows'], 6)));
    const cols = this.tableColumns();
    return Array.from({ length: n }, (_, i) => cols.map((c) => cellFor(c, r, i)));
  });

  protected readonly kanban = computed(() => {
    const r = rng(this.seed());
    const cols = list(this.p()['columns']);
    const per = Math.min(8, Math.max(1, num(this.p()['cardsPerColumn'], 3)));
    // A planned app supplies its own vocabulary; anything else falls back to the generic set.
    const planned = list(this.p()['cards']);
    let next = 0;
    return (cols.length ? cols : ['Todo', 'Doing', 'Done']).map((title, ci) => ({
      title,
      cards: Array.from({ length: Math.max(1, per - (ci % 2)) }, () => {
        const generated = taskCard(r);
        if (planned.length === 0) return generated;
        const label = planned[next % planned.length] as string;
        next += 1;
        return { ...generated, title: label };
      }),
    }));
  });

  protected readonly chat = computed(() => chatThread(rng(this.seed()), str(this.p()['agentName'], 'Agent')));
  protected readonly avatarName = computed(() => str(this.p()['name']) || personName(rng(this.seed())));
  protected readonly sparkline = computed(() => sparklinePoints(this.node().id, str(this.p()['trend'], 'up')));
  protected readonly pricingTiers = computed(() => {
    const tiers = list(this.p()['tiers']);
    const names = tiers.length ? tiers : ['Starter', 'Growth', 'Scale'];
    const yearly = str(this.p()['billing'], 'monthly') === 'yearly';
    const prices = [0, 29, 99, 249];
    const features = [
      ['1 project', 'Community support', 'Preview deploys'],
      ['Unlimited projects', 'Custom domains', 'Email support', 'Team of 5'],
      ['Everything in Growth', 'SSO and audit logs', 'Priority support', 'Unlimited seats'],
      ['Dedicated infrastructure', 'SLA', 'Solutions engineer'],
    ];
    return names.slice(0, 4).map((name, i) => ({
      name,
      price: prices[i] === 0 ? 'Free' : `$${yearly ? Math.round((prices[i] ?? 0) * 10) : prices[i]}`,
      period: prices[i] === 0 ? '' : yearly ? '/yr' : '/mo',
      features: features[i] ?? [],
      highlight: i === num(this.p()['highlight'], 1),
    }));
  });

  protected readonly buttonIcon = computed<IconName | null>(() => {
    const raw = str(this.p()['icon']);
    const map: Record<string, IconName> = { plus: 'plus', arrow: 'arrow-right', upload: 'upload', download: 'download', external: 'external-link', key: 'key', trash: 'trash', cart: 'shopping-cart', search: 'search', check: 'check', sparkles: 'sparkles' };
    if (raw in map) return map[raw] as IconName;
    return raw in ICONS ? (raw as IconName) : null;
  });

  protected childId(_: number, child: MadNode): NodeId {
    return child.id;
  }

  protected onClick(event: Event): void {
    if (!this.ctx.interactive()) return;
    event.stopPropagation();
    event.preventDefault();
    this.ctx.select(this.node().id);
  }
  protected onEnter(event: PointerEvent): void {
    if (!this.ctx.interactive()) return;
    event.stopPropagation();
    this.ctx.hover(this.node().id);
  }
  protected onLeave(event: PointerEvent): void {
    if (!this.ctx.interactive()) return;
    event.stopPropagation();
    if (this.ctx.hoveredId() === this.node().id) this.ctx.hover(null);
  }
  protected onDragOver(event: DragEvent): void {
    if (!this.ctx.interactive() || !this.isContainer()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.ctx.dragOver(this.node().id, this.dropIndexFor(event));
  }
  protected onDragLeave(event: DragEvent): void {
    if (!this.ctx.interactive()) return;
    event.stopPropagation();
    if (this.ctx.dropTargetId() === this.node().id) this.ctx.dragOver(null, 0);
  }
  protected onDrop(event: DragEvent): void {
    if (!this.ctx.interactive() || !this.isContainer()) return;
    event.preventDefault();
    event.stopPropagation();
    this.ctx.drop(this.node().id, this.dropIndexFor(event), event.dataTransfer);
  }

  /** Insertion index from pointer position relative to direct child nodes. */
  private dropIndexFor(event: DragEvent): number {
    const host = event.currentTarget as HTMLElement;
    const children = Array.from(host.querySelectorAll<HTMLElement>(':scope > .r-children > mad-node, :scope > .r-body > .r-children > mad-node'));
    const horizontal = this.s().direction === 'row' || this.node().type === 'grid';
    for (let i = 0; i < children.length; i += 1) {
      const rect = (children[i] as HTMLElement).getBoundingClientRect();
      const mid = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      const pos = horizontal ? event.clientX : event.clientY;
      if (pos < mid) return i;
    }
    return children.length;
  }

  private widthFor(w: NonNullable<StyleProps['width']>): string {
    switch (w) {
      case 'full':
        return '100%';
      case 'content':
        return 'max-content';
      case 'auto':
        return 'auto';
      default:
        return `calc(${w} * 100%)`;
    }
  }
  private alignFor(a: NonNullable<StyleProps['align']>): string {
    return a === 'start' ? 'flex-start' : a === 'end' ? 'flex-end' : a;
  }
  private justifyFor(j: NonNullable<StyleProps['justify']>): string {
    return j === 'between' ? 'space-between' : j === 'start' ? 'flex-start' : j === 'end' ? 'flex-end' : j;
  }
}
