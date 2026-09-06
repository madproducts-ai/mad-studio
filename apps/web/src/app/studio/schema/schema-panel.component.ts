import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Icon } from '../../core/ui/icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { StudioStore } from '../state/studio.store';

@Component({
  selector: 'mad-schema-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <header class="flex items-center justify-between border-b border-line p-3">
      <h2 class="font-sans text-step--1 font-semibold tracking-normal">Schema</h2>
      <button type="button" class="btn btn-ghost btn-sm h-7 gap-1 text-[0.7rem]" [disabled]="store.tables().length === 0" (click)="copySql()">
        <mad-icon [name]="copied() ? 'check' : 'copy'" [size]="12" /> {{ copied() ? 'Copied' : 'Export SQL' }}
      </button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      @if (store.tables().length === 0) {
        <p class="p-4 text-center text-step--1 text-ink-4">Tables appear here while the planner models your data.</p>
      }
      <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
        @for (t of store.tables(); track t.table) {
          <li class="rounded-xl border border-line bg-bg">
            <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left" (click)="toggle(t.table)" [attr.aria-expanded]="open().has(t.table)">
              <mad-icon name="database" [size]="13" class="text-signal" />
              <span class="mono text-[0.78rem] font-medium">{{ t.table }}</span>
              <span class="mono ml-auto text-[0.62rem] text-ink-4">{{ t.columns.length }} cols</span>
              <mad-icon [name]="open().has(t.table) ? 'chevron-down' : 'chevron-right'" [size]="12" class="text-ink-4" />
            </button>
            @if (open().has(t.table)) {
              <ul class="m-0 list-none border-t border-line p-2 pl-3">
                @for (c of t.columns; track c) {
                  <li class="mono flex items-center gap-2 py-0.5 text-[0.7rem]">
                    <span class="size-1 rounded-full" [class.bg-ember]="c === 'id'" [class.bg-signal]="c !== 'id' && c.endsWith('_id')" [class.bg-line-strong]="c !== 'id' && !c.endsWith('_id')"></span>
                    <span [class.text-ink]="c === 'id' || c.endsWith('_id')" [class.text-ink-3]="c !== 'id' && !c.endsWith('_id')">{{ c }}</span>
                    <span class="ml-auto text-ink-4">{{ typeHint(c) }}</span>
                  </li>
                }
              </ul>
            }
          </li>
        }
      </ul>
    </div>
    <footer class="border-t border-line p-3 text-[0.7rem] leading-snug text-ink-4">PostgreSQL. Foreign keys are inferred from <span class="mono">*_id</span> columns; export produces a transaction-wrapped migration.</footer>
  `,
})
export class SchemaPanel {
  protected readonly store = inject(StudioStore);
  private readonly toast = inject(ToastService);
  protected readonly open = signal<ReadonlySet<string>>(new Set());
  protected readonly copied = signal(false);

  protected toggle(table: string): void {
    this.open.update((set) => {
      const next = new Set(set);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  }

  protected typeHint(column: string): string {
    if (column === 'id') return 'uuid pk';
    if (column.endsWith('_id')) return 'uuid fk';
    if (column.endsWith('_at')) return 'timestamptz';
    if (column.endsWith('_cents') || column.endsWith('_qty') || column === 'quantity' || column === 'position') return 'integer';
    if (column === 'payload' || column === 'properties' || column === 'permissions') return 'jsonb';
    return 'text';
  }

  protected async copySql(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.store.schemaSql());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    } catch {
      this.toast.error('Clipboard unavailable', 'Your browser blocked clipboard access.');
    }
  }
}
