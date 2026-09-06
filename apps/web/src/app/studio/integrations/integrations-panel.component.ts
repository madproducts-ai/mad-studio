import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { INTEGRATION_RULES } from '@mad/planner';
import { Icon } from '../../core/ui/icon.component';
import { StudioStore } from '../state/studio.store';

@Component({
  selector: 'mad-integrations-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <header class="flex items-center justify-between border-b border-line p-3">
      <h2 class="font-sans text-step--1 font-semibold tracking-normal">Integrations</h2>
      <span class="mono text-[0.66rem] text-ink-4">{{ connected() }}/{{ store.integrations().length }} connected</span>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      @if (store.integrations().length === 0) {
        <p class="p-4 text-center text-step--1 text-ink-4">Integrations appear here as the planner wires them, or add one below.</p>
      }
      <ul class="m-0 flex list-none flex-col gap-1.5 p-2">
        @for (i of store.integrations(); track i.slug) {
          <li class="rounded-xl border border-line bg-bg p-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="flex items-center gap-2 text-[0.82rem] font-semibold">
                  <span class="size-2 shrink-0 rounded-full" [class.bg-success]="i.status === 'connected'" [class.bg-warning]="i.status === 'pending'" [class.bg-danger]="i.status === 'error'"></span>
                  {{ i.label }}
                </p>
                <p class="mono mt-0.5 text-[0.64rem] text-ink-4">{{ i.slug }}</p>
              </div>
              @if (i.status === 'connected') {
                <span class="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[0.64rem] font-medium text-success">Connected</span>
              } @else {
                <button type="button" class="btn btn-secondary btn-sm h-7 text-[0.7rem]" (click)="store.connectIntegration(i.slug)">Connect</button>
              }
            </div>
            @if (i.scopes.length) {
              <div class="mt-2 flex flex-wrap gap-1">
                @for (s of i.scopes; track s) {
                  <span class="mono rounded border border-line bg-panel px-1.5 py-0.5 text-[0.6rem] text-ink-3">{{ s }}</span>
                }
              </div>
            }
          </li>
        }
      </ul>

      <div class="border-t border-line p-2">
        <label class="relative mb-2 block">
          <mad-icon name="search" [size]="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input class="field h-8 pl-8 text-[0.78rem]" type="search" placeholder="Add an integration…" [value]="query()" (input)="query.set($any($event.target).value)" aria-label="Search integration catalog" />
        </label>
        <ul class="m-0 flex list-none flex-col p-0">
          @for (c of available(); track c.slug) {
            <li>
              <button type="button" class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover" (click)="store.attachIntegration(c.slug)">
                <span class="flex size-7 items-center justify-center rounded-md border border-line bg-panel text-ink-3"><mad-icon name="plug" [size]="13" /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[0.78rem] font-medium">{{ c.name }}</span>
                  <span class="block truncate text-[0.64rem] text-ink-4">{{ c.description }}</span>
                </span>
                <mad-icon name="plus" [size]="14" class="text-ink-4" />
              </button>
            </li>
          }
        </ul>
      </div>
    </div>
  `,
})
export class IntegrationsPanel {
  protected readonly store = inject(StudioStore);
  protected readonly query = signal('');
  protected readonly connected = computed(() => this.store.integrations().filter((i) => i.status === 'connected').length);

  protected readonly available = computed(() => {
    const wired = new Set(this.store.integrations().map((i) => i.slug));
    const q = this.query().trim().toLowerCase();
    const catalog = this.store.catalog().length
      ? this.store.catalog().map((c) => ({ slug: c.slug, name: c.name, description: c.description }))
      : INTEGRATION_RULES.map((r) => ({ slug: r.slug, name: r.label, description: `Scopes: ${r.scopes.join(', ')}` }));
    return catalog.filter((c) => !wired.has(c.slug) && (q === '' || c.name.toLowerCase().includes(q) || c.slug.includes(q))).slice(0, q ? 20 : 8);
  });
}
