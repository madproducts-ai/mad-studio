import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import { Icon } from '../../core/ui/icon.component';
import { StudioStore } from '../state/studio.store';

@Component({
  selector: 'mad-prompt-bar',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col border-t border-line bg-panel' },
  template: `
    @if (store.consoleOpen()) {
      <section class="console flex h-44 flex-col border-b border-line bg-bg" aria-label="Build console">
        <header class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[0.68rem] text-ink-3">
          <mad-icon name="terminal" [size]="12" />
          <span class="font-medium">Console</span>
          <span class="mono text-ink-4">{{ store.logs().length }} lines</span>
          @if (store.tokens(); as t) {
            <span class="mono ml-2 text-ink-4">tokens {{ t.input }} in · {{ t.output }} out</span>
          }
          <button type="button" class="btn btn-ghost btn-sm ml-auto h-6 text-[0.66rem]" (click)="store.clearLogs()">Clear</button>
          <button type="button" class="btn btn-ghost btn-icon size-6" aria-label="Close console" (click)="store.consoleOpen.set(false)"><mad-icon name="x" [size]="12" /></button>
        </header>
        <ol class="mono m-0 min-h-0 flex-1 list-none overflow-y-auto p-2 text-[0.7rem] leading-relaxed" #logList>
          @for (l of store.logs(); track l.id) {
            <li class="flex gap-3" [attr.data-level]="l.level">
              <span class="shrink-0 text-ink-4">{{ l.at.slice(11, 23) }}</span>
              <span class="w-12 shrink-0 uppercase text-[0.6rem] leading-[1.9]" [class.text-signal]="l.level === 'event'" [class.text-ink-4]="l.level === 'info'" [class.text-warning]="l.level === 'warn'" [class.text-danger]="l.level === 'error'">{{ l.level }}</span>
              <span class="text-ink-2">{{ l.message }}</span>
            </li>
          }
          @if (store.logs().length === 0) {
            <li class="text-ink-4">No output yet.</li>
          }
        </ol>
      </section>
    }

    @if (store.steps().length && (store.generating() || recentlyFinished())) {
      <div class="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line px-3 py-1.5" role="status" aria-live="polite" aria-label="Build plan">
        @for (s of store.steps(); track s.id) {
          <span class="step" [attr.data-status]="s.status" [title]="s.detail || s.label">
            @switch (s.status) {
              @case ('done') { <mad-icon name="check" [size]="10" /> }
              @case ('active') { <i class="pulse-dot size-1.5 rounded-full bg-signal"></i> }
              @case ('skipped') { <mad-icon name="minus" [size]="10" /> }
              @default { <i class="size-1.5 rounded-full bg-line-strong"></i> }
            }
            {{ s.label }}
          </span>
        }
        <span class="mono ml-auto shrink-0 pl-3 text-[0.68rem] tabular-nums" [class.text-success]="store.genStatus() === 'complete'" [class.text-ink-3]="store.genStatus() !== 'complete'">
          {{ (store.elapsedMs() / 1000).toFixed(1) }}s
          @if (store.genStatus() === 'complete') { · {{ store.nodeCount() }} nodes }
        </span>
      </div>
    }

    <form class="flex items-end gap-2 p-2.5" (submit)="submit($event)">
      <div class="prompt-shell flex min-w-0 flex-1 items-end gap-2 rounded-xl border border-line bg-bg px-3 py-2 transition-[border-color,box-shadow]" [class.is-busy]="store.generating()">
        <mad-icon name="sparkles" [size]="16" class="mb-1.5 shrink-0 text-ember" />
        <textarea
          #input
          class="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-[0.84rem] leading-6 text-ink outline-none placeholder:text-ink-4"
          rows="1"
          [value]="store.prompt()"
          [placeholder]="placeholder()"
          [disabled]="store.generating()"
          aria-label="Describe what to build"
          spellcheck="false"
          (input)="onInput($any($event.target))"
          (keydown)="onKeydown($event)"
        ></textarea>
        <span class="mb-1 hidden items-center gap-1 text-[0.62rem] text-ink-4 sm:flex"><kbd class="kbd">↵</kbd> build <kbd class="kbd ml-1">⇧↵</kbd> newline</span>
      </div>
      @if (store.generating()) {
        <button type="button" class="btn btn-secondary h-10 gap-1.5" (click)="store.cancelGeneration()">
          <mad-icon name="square" [size]="13" /> Stop
        </button>
      } @else {
        <button type="submit" class="btn btn-primary h-10 gap-1.5" [disabled]="store.prompt().trim().length < 4">
          {{ store.root() ? 'Rebuild' : 'Build' }}
          <mad-icon name="corner-down-left" [size]="14" />
        </button>
      }
    </form>
  `,
  styles: `
    .prompt-shell:focus-within { border-color: var(--mad-signal); box-shadow: 0 0 0 3px color-mix(in oklab, var(--mad-signal) 18%, transparent); }
    .prompt-shell.is-busy { border-color: color-mix(in oklab, var(--mad-signal) 40%, var(--mad-line)); background-image: linear-gradient(90deg, transparent, color-mix(in oklab, var(--mad-signal) 8%, transparent), transparent); background-size: 200% 100%; animation: busy 1.8s linear infinite; }
    @keyframes busy { to { background-position: -200% 0; } }
    .step { display: inline-flex; flex-shrink: 0; align-items: center; gap: 6px; height: 22px; padding: 0 8px; border-radius: 999px; border: 1px solid var(--mad-line); font-size: 0.66rem; color: var(--mad-ink-4); white-space: nowrap; transition: color 0.2s ease, border-color 0.2s ease, background-color 0.2s ease; }
    .step[data-status='active'] { color: var(--mad-ink); border-color: color-mix(in oklab, var(--mad-signal) 50%, transparent); background: color-mix(in oklab, var(--mad-signal) 8%, transparent); }
    .step[data-status='done'] { color: var(--mad-ink-2); }
    .step[data-status='done'] mad-icon { color: var(--mad-success); }
    .console li[data-level='error'] span:last-child { color: var(--mad-danger); }
  `,
})
export class PromptBar {
  protected readonly store = inject(StudioStore);
  private readonly input = viewChild.required<ElementRef<HTMLTextAreaElement>>('input');

  protected readonly placeholder = computed(() =>
    this.store.root() ? 'Describe a change or a new build: "add a kanban board for onboarding tasks"' : 'Build an internal CRM dashboard with Stripe billing and a customer support chat',
  );
  protected readonly recentlyFinished = computed(() => {
    const f = this.store.finishedAt();
    return f !== null && this.store.genStatus() === 'complete' && Date.now() - f < 12000;
  });

  focus(): void {
    this.input().nativeElement.focus();
  }

  protected onInput(el: HTMLTextAreaElement): void {
    this.store.prompt.set(el.value);
    el.style.height = 'auto';
    el.style.height = `${Math.min(128, el.scrollHeight)}px`;
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.submit();
    }
  }

  protected async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    const text = this.store.prompt().trim();
    if (text.length < 4 || this.store.generating()) return;
    const el = this.input().nativeElement;
    el.style.height = 'auto';
    await this.store.generate(text, { intoCurrentProject: this.store.root() !== null && !this.store.isLocal() });
  }
}
