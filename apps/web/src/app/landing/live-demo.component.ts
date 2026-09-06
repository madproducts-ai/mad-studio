import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import type { GenerationEvent, MadNode, PlanStep } from '@mad/schema';
import { insertNode, patchNode, removeNode } from '@mad/schema';
import { OfflineRunner } from '../core/api/offline-runner';
import { DeviceFrame } from '../core/render/device-frame.component';
import { RenderContext } from '../core/render/render-context';
import { Icon } from '../core/ui/icon.component';

const DEMO_PROMPT = 'Build an internal CRM dashboard with Stripe billing and a customer support chat';

/**
 * The hero's proof: the real planner and the real renderer, running in the
 * browser, assembling the canonical prompt on a loop with a live stopwatch.
 */
@Component({
  selector: 'mad-live-demo',
  imports: [DeviceFrame, Icon],
  providers: [RenderContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="demo panel relative overflow-hidden">
      <div class="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <span class="flex items-center gap-1.5">
          <i class="size-2.5 rounded-full bg-line-strong"></i><i class="size-2.5 rounded-full bg-line-strong"></i><i class="size-2.5 rounded-full bg-line-strong"></i>
        </span>
        <span class="mono truncate text-step--2 text-ink-3">
          <span class="text-signal">&gt;</span> {{ typed() }}<span [class.caret]="typing()"></span>
        </span>
        <span class="mono ml-auto flex items-center gap-2 text-step--2 tabular-nums" [class.text-success]="done()" [class.text-ink-3]="!done()">
          @if (done()) {
            <mad-icon name="check-circle" [size]="14" />
          } @else {
            <i class="pulse-dot size-1.5 rounded-full bg-signal"></i>
          }
          {{ elapsedLabel() }}
        </span>
      </div>

      <div class="grid md:grid-cols-[minmax(0,1fr)_220px]">
        <div class="frame-well relative overflow-hidden bg-bg" #well>
          <div class="absolute inset-0 dot-bg opacity-60"></div>
          <div class="relative p-4">
            <mad-device-frame [root]="root()" device="desktop" designSystem="tailwind" theme="dark" [scale]="scale()" urlLabel="crm-dashboard.preview.madproducts.app">
              <span class="mono text-step--1 text-ink-4">Reading the brief…</span>
            </mad-device-frame>
          </div>
        </div>
        <aside class="hidden border-l border-line bg-panel/60 p-3 md:block">
          <p class="eyebrow mb-3 text-[0.62rem]">Build plan</p>
          <ol class="m-0 flex list-none flex-col gap-1.5 p-0">
            @for (s of steps(); track s.id) {
              <li class="flex items-start gap-2 text-step--2 leading-snug" [class.text-ink-4]="s.status === 'pending'" [class.text-ink]="s.status !== 'pending'">
                <span class="mt-[3px] flex size-3 shrink-0 items-center justify-center">
                  @switch (s.status) {
                    @case ('done') {
                      <mad-icon name="check" [size]="11" class="text-success" />
                    }
                    @case ('active') {
                      <i class="pulse-dot size-1.5 rounded-full bg-signal"></i>
                    }
                    @default {
                      <i class="size-1 rounded-full bg-line-strong"></i>
                    }
                  }
                </span>
                <span>{{ s.label }}</span>
              </li>
            }
          </ol>
          @if (tables().length) {
            <p class="eyebrow mt-4 mb-2 text-[0.62rem]">Schema</p>
            <div class="flex flex-wrap gap-1">
              @for (t of tables(); track t) {
                <span class="mono rounded border border-line bg-raised px-1.5 py-0.5 text-[0.62rem] text-ink-2">{{ t }}</span>
              }
            </div>
          }
          @if (integrations().length) {
            <p class="eyebrow mt-4 mb-2 text-[0.62rem]">Integrations</p>
            <div class="flex flex-wrap gap-1">
              @for (i of integrations(); track i) {
                <span class="rounded-full border border-line px-2 py-0.5 text-[0.66rem] text-ink-2">{{ i }}</span>
              }
            </div>
          }
        </aside>
      </div>
    </div>
  `,
  styles: `
    .frame-well { min-height: 360px; }
    .frame-well mad-device-frame { display: block; margin: 0 auto; }
  `,
})
export class LiveDemo {
  private readonly ctx = inject(RenderContext);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly root = signal<MadNode | null>(null);
  protected readonly steps = signal<PlanStep[]>([]);
  protected readonly tables = signal<string[]>([]);
  protected readonly integrations = signal<string[]>([]);
  protected readonly typed = signal('');
  protected readonly typing = signal(true);
  protected readonly done = signal(false);
  protected readonly scale = signal(0.42);
  private readonly startedAt = signal<number | null>(null);
  private readonly now = signal(Date.now());
  protected readonly elapsedLabel = computed(() => {
    const s = this.startedAt();
    if (s === null) return '0.0s';
    const ms = Math.max(0, (this.done() ? this.finishedAt : this.now()) - s);
    return `${(ms / 1000).toFixed(1)}s`;
  });

  private finishedAt = 0;
  private runner: OfflineRunner | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private inView = false;

  constructor() {
    afterNextRender(() => {
      const ro = new ResizeObserver(([entry]) => {
        const w = entry?.contentRect.width ?? 600;
        // Fit the 1440px desktop viewport into the available well, minus padding.
        this.scale.set(Math.max(0.24, Math.min(0.6, (w - 32) / 1440)));
      });
      const well = this.host.nativeElement.querySelector('.frame-well');
      if (well) ro.observe(well);

      const io = new IntersectionObserver(([e]) => {
        this.inView = e?.isIntersecting ?? false;
        if (this.inView && !this.runner && !this.done()) this.startCycle();
      });
      io.observe(this.host.nativeElement);

      this.destroyRef.onDestroy(() => {
        ro.disconnect();
        io.disconnect();
        this.stop();
      });
    });
  }

  private startCycle(): void {
    this.reset();
    // Type the prompt, then run.
    let i = 0;
    const type = () => {
      i += 1 + Math.floor(Math.random() * 2);
      this.typed.set(DEMO_PROMPT.slice(0, i));
      if (i < DEMO_PROMPT.length) {
        this.timers.push(setTimeout(type, 22 + Math.random() * 40));
      } else {
        this.typing.set(false);
        this.timers.push(setTimeout(() => this.run(), 400));
      }
    };
    type();
  }

  private run(): void {
    this.startedAt.set(Date.now());
    this.ticker = setInterval(() => this.now.set(Date.now()), 100);
    this.runner = new OfflineRunner(
      DEMO_PROMPT,
      { designSystem: 'tailwind', pace: 0.75 },
      (e) => this.apply(e),
      () => {
        this.finishedAt = Date.now();
        this.done.set(true);
        if (this.ticker) clearInterval(this.ticker);
        this.runner = null;
        // Hold the finished state, then loop.
        this.timers.push(setTimeout(() => (this.inView ? this.startCycle() : this.reset()), 7000));
      },
    );
    this.runner.start();
  }

  private apply(e: GenerationEvent): void {
    switch (e.type) {
      case 'plan':
        this.steps.set(e.steps);
        break;
      case 'step':
        this.steps.update((list) => list.map((s) => (s.id === e.stepId ? { ...s, status: e.status } : s)));
        break;
      case 'node.add': {
        const current = this.root();
        this.root.set(current === null || e.parentId === null ? e.node : insertNode(current, e.parentId, e.index, e.node));
        this.ctx.markEntering([e.node.id]);
        break;
      }
      case 'node.patch': {
        const current = this.root();
        if (current) this.root.set(patchNode(current, e.nodeId, { ...(e.props ? { props: e.props } : {}), ...(e.style ? { style: e.style } : {}), ...(e.name ? { name: e.name } : {}) }));
        break;
      }
      case 'node.remove': {
        const current = this.root();
        if (current) this.root.set(removeNode(current, e.nodeId));
        break;
      }
      case 'schema.table':
        this.tables.update((t) => [...t, e.table]);
        break;
      case 'integration.add':
        this.integrations.update((i) => [...i, e.label]);
        break;
      default:
        break;
    }
  }

  private reset(): void {
    this.stop();
    this.root.set(null);
    this.steps.set([]);
    this.tables.set([]);
    this.integrations.set([]);
    this.typed.set('');
    this.typing.set(true);
    this.done.set(false);
    this.startedAt.set(null);
  }

  private stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.runner?.cancel();
    this.runner = null;
  }
}
