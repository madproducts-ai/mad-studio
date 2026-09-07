import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import type { MadNode, NodeId, NodeType } from '@mad/schema';
import { isContainer, findParent } from '@mad/schema';
import { Icon, type IconName } from '../../core/ui/icon.component';
import { DRAG_MIME } from '../../core/render/render-context';
import { StudioStore } from '../state/studio.store';

interface Row {
  node: MadNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export const TYPE_ICON: Record<NodeType, IconName> = {
  page: 'panel',
  nav: 'panel-bottom',
  sidebar: 'panel',
  section: 'layout-grid',
  stack: 'columns',
  grid: 'layout-grid',
  card: 'square',
  heading: 'type',
  text: 'align-left',
  button: 'mouse-pointer',
  input: 'type',
  select: 'chevron-down',
  toggle: 'toggle-right',
  badge: 'hash',
  avatar: 'users',
  divider: 'minus',
  image: 'image',
  stat: 'trending-up',
  chart: 'bar-chart',
  table: 'list',
  list: 'list',
  tabs: 'columns',
  kanban: 'columns',
  form: 'align-left',
  chat: 'message-square',
  timeline: 'activity',
  pricing: 'credit-card',
};

@Component({
  selector: 'mad-layer-tree',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <header class="flex items-center justify-between border-b border-line p-3">
      <h2 class="font-sans text-step--1 font-semibold tracking-normal">Layers</h2>
      <span class="mono text-[0.66rem] text-ink-4">{{ store.nodeCount() }} nodes</span>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto py-1" role="tree" aria-label="Document layers">
      @if (rows().length === 0) {
        <p class="p-4 text-center text-step--1 text-ink-4">Nothing on the canvas yet.</p>
      }
      @for (r of rows(); track r.node.id) {
        <div
          role="treeitem"
          class="row"
          [class.is-selected]="store.selectedId() === r.node.id"
          [class.is-hidden]="r.node.style.hidden"
          [class.is-drop-before]="drop()?.id === r.node.id && drop()?.pos === 'before'"
          [class.is-drop-after]="drop()?.id === r.node.id && drop()?.pos === 'after'"
          [class.is-drop-inside]="drop()?.id === r.node.id && drop()?.pos === 'inside'"
          [style.--depth]="r.depth"
          [attr.aria-level]="r.depth + 1"
          [attr.aria-selected]="store.selectedId() === r.node.id"
          [attr.aria-expanded]="r.hasChildren ? r.expanded : null"
          [attr.tabindex]="tabbableId() === r.node.id ? 0 : -1"
          draggable="true"
          (click)="store.select(r.node.id)"
          (keydown)="onKeydown($event, $index)"
          (dblclick)="toggle(r.node.id)"
          (dragstart)="onDragStart($event, r.node)"
          (dragover)="onDragOver($event, r)"
          (dragleave)="drop.set(null)"
          (drop)="onDrop($event, r)"
          (dragend)="drop.set(null)"
        >
          <button type="button" class="disclosure" [class.invisible]="!r.hasChildren" [attr.aria-label]="r.expanded ? 'Collapse' : 'Expand'" tabindex="-1" (click)="toggle(r.node.id); $event.stopPropagation()">
            <mad-icon [name]="r.expanded ? 'chevron-down' : 'chevron-right'" [size]="12" />
          </button>
          <mad-icon [name]="icon(r.node.type)" [size]="13" class="shrink-0 text-ink-4" />
          <span class="truncate text-[0.78rem]">{{ r.node.name }}</span>
          <span class="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 [.row:hover_&]:opacity-100 [.row.is-selected_&]:opacity-100">
            @if (r.node.locked) {
              <mad-icon name="lock" [size]="11" class="text-ink-4" />
            }
            <button type="button" class="mini" [attr.aria-label]="r.node.style.hidden ? 'Show' : 'Hide'" tabindex="-1" (click)="store.toggleHidden(r.node.id); $event.stopPropagation()">
              <mad-icon [name]="r.node.style.hidden ? 'eye-off' : 'eye'" [size]="12" />
            </button>
          </span>
        </div>
      }
    </div>
  `,
  styles: `
    .row { position: relative; display: flex; align-items: center; gap: 4px; height: 28px; padding-left: calc(6px + var(--depth) * 14px); padding-right: 8px; color: var(--mad-ink-2); cursor: default; border-left: 2px solid transparent; }
    .row:hover { background: var(--mad-hover); color: var(--mad-ink); }
    .row.is-selected { background: color-mix(in oklab, var(--mad-signal) 12%, transparent); color: var(--mad-ink); border-left-color: var(--mad-signal); }
    .row.is-hidden { opacity: 0.5; }
    .row:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--mad-signal); }
    .row.is-drop-before::before, .row.is-drop-after::after { content: ''; position: absolute; left: calc(6px + var(--depth) * 14px); right: 8px; height: 2px; background: var(--mad-ember); border-radius: 1px; }
    .row.is-drop-before::before { top: -1px; }
    .row.is-drop-after::after { bottom: -1px; }
    .row.is-drop-inside { box-shadow: inset 0 0 0 1px var(--mad-ember); background: color-mix(in oklab, var(--mad-ember) 10%, transparent); }
    .disclosure { display: flex; width: 16px; height: 16px; align-items: center; justify-content: center; border-radius: 4px; color: var(--mad-ink-4); }
    .disclosure:hover { background: var(--mad-raised); color: var(--mad-ink); }
    .mini { display: flex; width: 20px; height: 20px; align-items: center; justify-content: center; border-radius: 4px; color: var(--mad-ink-4); }
    .mini:hover { background: var(--mad-raised); color: var(--mad-ink); }
  `,
})
export class LayerTree {
  protected readonly store = inject(StudioStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly collapsed = signal<ReadonlySet<NodeId>>(new Set());
  protected readonly drop = signal<{ id: NodeId; pos: 'before' | 'after' | 'inside' } | null>(null);

  protected readonly rows = computed<Row[]>(() => {
    const root = this.store.root();
    if (!root) return [];
    const out: Row[] = [];
    const collapsed = this.collapsed();
    const walk = (node: MadNode, depth: number) => {
      const expanded = !collapsed.has(node.id);
      out.push({ node, depth, hasChildren: node.children.length > 0, expanded });
      if (expanded) for (const c of node.children) walk(c, depth + 1);
    };
    walk(root, 0);
    return out;
  });

  /**
   * The tree is one tab stop, not one per node: the selected row holds it, and
   * the first row stands in whenever the selection is absent or collapsed away.
   */
  protected readonly tabbableId = computed<NodeId | null>(() => {
    const rows = this.rows();
    const selected = this.store.selectedId();
    if (selected && rows.some((r) => r.node.id === selected)) return selected;
    return rows[0]?.node.id ?? null;
  });

  /**
   * The standard tree keyboard model, walked over the flattened rows: the arrows
   * and Home/End carry focus and selection together, and left/right also close
   * and open branches. Handled keys stop here, since the studio binds the same
   * arrows on the window to move the canvas selection.
   */
  protected onKeydown(event: KeyboardEvent, index: number): void {
    const rows = this.rows();
    const row = rows[index];
    if (!row || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowDown':
        this.focusRow(index + 1);
        break;
      case 'ArrowUp':
        this.focusRow(index - 1);
        break;
      case 'Home':
        this.focusRow(0);
        break;
      case 'End':
        this.focusRow(rows.length - 1);
        break;
      case 'ArrowRight':
        if (!row.hasChildren) return;
        if (row.expanded) this.focusRow(index + 1);
        else this.toggleAndSelect(row.node.id);
        break;
      case 'ArrowLeft':
        if (row.hasChildren && row.expanded) this.toggleAndSelect(row.node.id);
        else this.focusRow(this.parentIndex(index));
        break;
      case 'Enter':
        this.store.select(row.node.id);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** Toggles a branch from the keyboard, keeping the selection on the row that stays focused. */
  private toggleAndSelect(id: NodeId): void {
    this.toggle(id);
    this.store.select(id);
  }

  /** The nearest row above `index` that sits a level shallower, or -1 at the root. */
  private parentIndex(index: number): number {
    const rows = this.rows();
    const depth = rows[index]?.depth ?? 0;
    for (let i = index - 1; i >= 0; i--) {
      const above = rows[i];
      if (above && above.depth < depth) return i;
    }
    return -1;
  }

  /** Selecting alone would leave the caret behind, so the row element takes focus as well. */
  private focusRow(index: number): void {
    const target = this.rows()[index];
    if (!target) return;
    this.store.select(target.node.id);
    this.host.nativeElement.querySelectorAll<HTMLElement>('[role=treeitem]')[index]?.focus();
  }

  protected icon(type: NodeType): IconName {
    return TYPE_ICON[type];
  }

  protected toggle(id: NodeId): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected onDragStart(event: DragEvent, node: MadNode): void {
    const root = this.store.root();
    if (!event.dataTransfer || !root || node.id === root.id) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'node', id: node.id }));
    event.dataTransfer.setData('text/plain', node.name);
    event.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(event: DragEvent, row: Row): void {
    if (!event.dataTransfer?.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (event.clientY - rect.top) / rect.height;
    const container = isContainer(row.node.type);
    const pos: 'before' | 'after' | 'inside' = container && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after';
    const root = this.store.root();
    if (root && row.node.id === root.id && pos !== 'inside') return;
    this.drop.set({ id: row.node.id, pos });
  }

  protected onDrop(event: DragEvent, row: Row): void {
    event.preventDefault();
    const target = this.drop();
    this.drop.set(null);
    const raw = event.dataTransfer?.getData(DRAG_MIME);
    const root = this.store.root();
    if (!raw || !target || !root) return;
    let payload: { kind: 'preset' | 'node'; id: string };
    try {
      payload = JSON.parse(raw) as { kind: 'preset' | 'node'; id: string };
    } catch {
      return;
    }
    let parentId: NodeId;
    let index: number;
    if (target.pos === 'inside') {
      parentId = row.node.id;
      index = row.node.children.length;
    } else {
      const parent = findParent(root, row.node.id);
      if (!parent) return;
      parentId = parent.id;
      const idx = parent.children.findIndex((c) => c.id === row.node.id);
      index = target.pos === 'before' ? idx : idx + 1;
    }
    if (payload.kind === 'preset') this.store.insertPreset(parentId, index, payload.id);
    else this.store.moveNodeTo(payload.id, parentId, index);
  }
}
