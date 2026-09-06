import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ProjectDocument } from '@mad/schema';
import { ApiClient } from '../../core/api/api-client';
import { Icon } from '../../core/ui/icon.component';
import { StudioStore } from '../state/studio.store';

@Component({
  selector: 'mad-history-panel',
  imports: [Icon, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <header class="flex items-center justify-between border-b border-line p-3">
      <h2 class="font-sans text-step--1 font-semibold tracking-normal">History</h2>
      <button type="button" class="btn btn-ghost btn-sm h-7 text-[0.7rem]" (click)="refresh()" [disabled]="loading()">
        <mad-icon name="history" [size]="12" [class.animate-spin]="loading()" /> Refresh
      </button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      @if (store.lastPrompt(); as p) {
        <section class="mb-3 rounded-xl border border-line bg-bg p-3">
          <p class="eyebrow mb-1.5 text-[0.6rem]">Last prompt</p>
          <p class="text-[0.78rem] leading-snug text-ink-2">{{ p }}</p>
          <button type="button" class="btn btn-secondary btn-sm mt-2 h-7 w-full text-[0.7rem]" (click)="store.generate(p, { intoCurrentProject: true })" [disabled]="store.generating()">
            <mad-icon name="sparkles" [size]="12" /> Re-run
          </button>
        </section>
      }

      <p class="eyebrow mb-1.5 px-1 text-[0.6rem]">Versions</p>
      @if (store.isLocal()) {
        <p class="px-1 pb-3 text-[0.72rem] text-ink-4">Local projects keep undo history only. Connect the API for versioned documents.</p>
      } @else if (versions().length === 0 && !loading()) {
        <p class="px-1 pb-3 text-[0.72rem] text-ink-4">No saved versions yet.</p>
      }
      <ol class="m-0 flex list-none flex-col gap-1 p-0">
        @for (v of versions(); track v.version) {
          <li class="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2" [class.ring-1]="v.version === store.documentVersion()" [class.ring-signal]="v.version === store.documentVersion()">
            <span class="mono text-[0.72rem] text-ink">v{{ v.version }}</span>
            <span class="rounded-full border border-line px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider" [class.text-ember]="v.authoredBy === 'ai'" [class.text-ink-3]="v.authoredBy === 'user'">{{ v.authoredBy }}</span>
            <span class="ml-auto text-[0.66rem] text-ink-4">{{ v.createdAt | date }}</span>
          </li>
        }
      </ol>

      <p class="eyebrow mt-4 mb-1.5 px-1 text-[0.6rem]">Local projects</p>
      @if (locals().length === 0) {
        <p class="px-1 text-[0.72rem] text-ink-4">None in this browser.</p>
      }
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        @for (l of locals(); track l.id) {
          <li>
            <a [routerLink]="['/studio', l.id]" class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-hover" [class.bg-raised]="l.id === store.projectId()">
              <mad-icon name="cloud-off" [size]="12" class="text-ink-4" />
              <span class="min-w-0 flex-1 truncate text-[0.76rem]">{{ l.name }}</span>
              <span class="text-[0.62rem] text-ink-4">{{ l.updatedAt | date }}</span>
            </a>
          </li>
        }
      </ul>
    </div>
  `,
})
export class HistoryPanel {
  protected readonly store = inject(StudioStore);
  private readonly api = inject(ApiClient);
  protected readonly versions = signal<ProjectDocument[]>([]);
  protected readonly loading = signal(false);
  protected readonly locals = computed(() => this.store.listLocalProjects());

  constructor() {
    this.refresh();
  }

  protected refresh(): void {
    const id = this.store.projectId();
    if (!id || id.startsWith('local-') || this.store.mode() !== 'api') return;
    this.loading.set(true);
    fetch(`${this.api.baseUrl}/projects/${id}/document/history?limit=20`)
      .then((r) => (r.ok ? (r.json() as Promise<ProjectDocument[]>) : Promise.reject(new Error(r.statusText))))
      .then((list) => this.versions.set(list))
      .catch(() => this.versions.set([]))
      .finally(() => this.loading.set(false));
  }
}
