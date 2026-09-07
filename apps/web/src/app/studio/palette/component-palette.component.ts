import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import type { ComponentPreset } from '@mad/schema';
import { PRESET_CATEGORIES } from '@mad/planner';
import { Icon, type IconName } from '../../core/ui/icon.component';
import { DRAG_MIME } from '../../core/render/render-context';
import { StudioStore } from '../state/studio.store';

const CATEGORY_ICON: Record<ComponentPreset['category'], IconName> = {
  layout: 'layout-grid',
  navigation: 'panel',
  data: 'bar-chart',
  forms: 'align-left',
  commerce: 'shopping-cart',
  communication: 'message-square',
  marketing: 'zap',
};

type CategoryOption = { id: ComponentPreset['category'] | null; label: string };

@Component({
  selector: 'mad-component-palette',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <header class="flex shrink-0 flex-col gap-2 border-b border-line p-3">
      <div class="flex items-center justify-between">
        <h2 class="font-sans text-step--1 font-semibold tracking-normal">Components</h2>
        <span class="mono text-[0.66rem] text-ink-4">{{ store.designSystem() }} · {{ filtered().length }}</span>
      </div>
      <label class="relative block">
        <mad-icon name="search" [size]="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
        <input class="field h-8 pl-8 text-[0.78rem]" type="search" placeholder="Search presets…" [value]="query()" (input)="query.set($any($event.target).value)" aria-label="Search components" />
      </label>
      <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Filter presets by category">
        @for (c of categoryOptions; track c.label) {
          <button
            type="button"
            role="radio"
            class="cat"
            [class.is-active]="category() === c.id"
            [attr.aria-checked]="category() === c.id"
            [attr.tabindex]="category() === c.id ? 0 : -1"
            (click)="category.set(c.id)"
            (keydown)="onCategoryKeydown($event, $index)"
          >
            {{ c.label }}
          </button>
        }
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      @if (filtered().length === 0) {
        <p class="p-4 text-center text-step--1 text-ink-4">No presets match "{{ query() }}".</p>
      }
      <div class="grid gap-2" role="toolbar" aria-label="Component presets" [style.grid-template-columns]="'repeat(' + columns + ', minmax(0, 1fr))'">
        @for (p of filtered(); track p.id) {
          <button
            type="button"
            class="preset group"
            draggable="true"
            [attr.aria-label]="'Insert ' + p.name"
            [attr.tabindex]="tabbableId() === p.id ? 0 : -1"
            [title]="p.description + ' — drag onto the canvas or click to insert'"
            (focus)="lastFocused.set(p.id)"
            (keydown)="onPresetKeydown($event, $index)"
            (dragstart)="onDragStart($event, p)"
            (dragend)="dragging.set(null)"
            (click)="store.insertPresetAtSelection(p.id)"
            [class.is-dragging]="dragging() === p.id"
          >
            <span class="preset-visual" [attr.data-cat]="p.category">
              <mad-icon [name]="icon(p)" [size]="16" />
            </span>
            <span class="preset-name">{{ p.name }}</span>
            <span class="preset-desc">{{ p.description }}</span>
          </button>
        }
      </div>
    </div>

    <footer class="hidden shrink-0 border-t border-line p-3 text-[0.7rem] leading-snug text-ink-4 min-[600px]:block">
      Drag onto a container, or click to insert into the selected one. Arrow keys move between presets.
    </footer>
  `,
  styles: `
    .cat { padding: 3px 8px; border-radius: 999px; font-size: 0.68rem; color: var(--mad-ink-3); border: 1px solid transparent; }
    .cat:hover { color: var(--mad-ink); background: var(--mad-hover); }
    .cat.is-active { color: var(--mad-ink); border-color: var(--mad-line-strong); background: var(--mad-raised); }
    .preset { display: flex; width: 100%; flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px; border-radius: 10px; border: 1px solid var(--mad-line); background: var(--mad-bg); text-align: left; cursor: grab; transition: border-color 0.15s ease, transform 0.4s var(--ease-spring), background-color 0.15s ease; }
    .preset:hover { border-color: var(--mad-line-strong); background: var(--mad-raised); transform: translateY(-1px); }
    .preset:active { cursor: grabbing; transform: scale(0.98); }
    .preset.is-dragging { opacity: 0.5; }
    .preset-visual { display: flex; width: 100%; height: 44px; align-items: center; justify-content: center; border-radius: 6px; background: var(--mad-panel); color: var(--mad-ink-3); border: 1px dashed var(--mad-line); }
    .preset:hover .preset-visual { color: var(--mad-ember); border-style: solid; }
    .preset-name { font-size: 0.76rem; font-weight: 600; color: var(--mad-ink); }
    .preset-desc { font-size: 0.66rem; color: var(--mad-ink-4); line-height: 1.3; }
  `,
})
export class ComponentPalette {
  protected readonly store = inject(StudioStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly categoryOptions: readonly CategoryOption[] = [{ id: null, label: 'All' }, ...PRESET_CATEGORIES];
  protected readonly query = signal('');
  protected readonly category = signal<ComponentPreset['category'] | null>(null);
  protected readonly dragging = signal<string | null>(null);
  /** Grid track count. The template lays the grid out from this, so the up/down key maths cannot drift from the columns on screen. */
  protected readonly columns = 2;
  /** Which preset holds the grid's tab stop. Follows the arrows and any focus the user gives a preset directly. */
  protected readonly lastFocused = signal<string | null>(null);

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const cat = this.category();
    return this.store.presets().filter((p) => (cat === null || p.category === cat) && (q === '' || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.keywords.some((k) => k.includes(q))));
  });

  /**
   * The grid is one tab stop, not one per preset: 23 presets and 8 filters would
   * otherwise sit between the search box and everything after this panel. The
   * remembered preset holds it, and the first one stands in when a filter or a
   * search hides that preset.
   */
  protected readonly tabbableId = computed<string | null>(() => {
    const items = this.filtered();
    const last = this.lastFocused();
    if (last !== null && items.some((p) => p.id === last)) return last;
    return items[0]?.id ?? null;
  });

  /**
   * Arrows walk the preset grid, left and right by one and up and down by a row,
   * with Home and End for its ends. Handled keys stop here, since the studio binds
   * the same arrows on the window to move the canvas selection. Enter and Space
   * fall through untouched so the button activates itself and inserts the preset.
   */
  protected onPresetKeydown(event: KeyboardEvent, index: number): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const lastIndex = this.filtered().length - 1;
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
        target = index + 1;
        break;
      case 'ArrowLeft':
        target = index - 1;
        break;
      case 'ArrowDown':
        target = index + this.columns;
        break;
      case 'ArrowUp':
        target = index - this.columns;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = lastIndex;
        break;
      default:
        return;
    }
    // Swallowed even when the edge stops the move, so the panel does not scroll
    // and the canvas selection does not shift underneath.
    event.preventDefault();
    event.stopPropagation();
    if (target < 0 || target > lastIndex) return;
    this.focusIn('.preset', target, this.filtered()[target]?.id ?? null);
  }

  /** The filter chips are a radio group: one tab stop on the active chip, arrows both move and choose. */
  protected onCategoryKeydown(event: KeyboardEvent, index: number): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = index - 1;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = this.categoryOptions.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const option = this.categoryOptions[target];
    if (!option) return;
    this.category.set(option.id);
    this.focusIn('.cat', target, null);
  }

  /** Moving the tab stop is not enough on its own: the element has to take focus, or the caret is left behind. */
  private focusIn(selector: string, index: number, remember: string | null): void {
    if (remember !== null) this.lastFocused.set(remember);
    this.host.nativeElement.querySelectorAll<HTMLElement>(selector)[index]?.focus();
  }

  protected icon(preset: ComponentPreset): IconName {
    const id = preset.id.replace(/^p_[a-z]+-/, '');
    const byId: Record<string, IconName> = {
      'stat-card': 'trending-up',
      'kpi-row': 'layout-grid',
      'area-chart': 'activity',
      'bar-chart': 'bar-chart',
      'donut-chart': 'minus-circle',
      'data-table': 'list',
      kanban: 'columns',
      timeline: 'history',
      card: 'square',
      'two-column': 'columns',
      'three-column': 'layout-grid',
      'section-header': 'type',
      tabs: 'panel-bottom',
      toolbar: 'search',
      'contact-form': 'mail',
      'login-form': 'lock',
      'settings-toggles': 'toggle-right',
      pricing: 'credit-card',
      'product-card': 'shopping-cart',
      chat: 'message-square',
      'inbox-list': 'list',
      hero: 'zap',
      'cta-banner': 'bell',
    };
    return byId[id] ?? CATEGORY_ICON[preset.category];
  }

  protected onDragStart(event: DragEvent, preset: ComponentPreset): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'preset', id: preset.id }));
    event.dataTransfer.setData('text/plain', preset.name);
    event.dataTransfer.effectAllowed = 'copy';
    this.dragging.set(preset.id);
  }
}
