import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { DEVICE_VIEWPORTS } from '@mad/schema';
import { DeviceFrame } from '../../core/render/device-frame.component';
import { RenderContext } from '../../core/render/render-context';
import { Icon } from '../../core/ui/icon.component';
import { StudioStore } from '../state/studio.store';

@Component({
  selector: 'mad-studio-canvas',
  imports: [DeviceFrame, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg' },
  template: `
    <div class="absolute inset-0 dot-bg opacity-70" aria-hidden="true"></div>

    <!-- breadcrumb -->
    @if (store.selectedPath().length) {
      <nav class="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-x-auto rounded-lg border border-line bg-panel/80 px-2 py-1 text-[0.7rem] backdrop-blur" aria-label="Selection path">
        @for (n of store.selectedPath(); track n.id; let last = $last) {
          <button type="button" class="rounded px-1 py-0.5 whitespace-nowrap hover:bg-hover" [class.text-ink]="last" [class.text-ink-3]="!last" (click)="store.select(n.id)">{{ n.name }}</button>
          @if (!last) {
            <mad-icon name="chevron-right" [size]="10" class="text-ink-4" />
          }
        }
      </nav>
    }

    <!-- generating chip -->
    @if (store.generating()) {
      <div class="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-line bg-panel/80 px-2.5 py-1.5 text-[0.72rem] backdrop-blur" role="status" aria-live="polite">
        <i class="pulse-dot size-1.5 rounded-full bg-signal"></i>
        <span class="text-ink-2">{{ store.statusMessage() || 'Building' }}</span>
        <span class="mono text-ink-4">{{ (store.elapsedMs() / 1000).toFixed(1) }}s</span>
      </div>
    }

    <div #scroller class="relative min-h-0 flex-1 overflow-auto" (click)="onBackgroundClick($event)">
      <div class="flex min-h-full items-start justify-center p-8" [style.min-width.px]="frameWidth() + 64">
        @if (store.root(); as root) {
          <mad-device-frame
            [root]="root"
            [device]="store.device()"
            [designSystem]="store.designSystem()"
            [theme]="store.previewTheme()"
            [scale]="scale()"
            [urlLabel]="urlLabel()"
          />
        } @else if (store.generating()) {
          <mad-device-frame [root]="null" [device]="store.device()" [designSystem]="store.designSystem()" [theme]="store.previewTheme()" [scale]="scale()" [urlLabel]="urlLabel()">
            <div class="flex flex-col items-center gap-3 text-center">
              <span class="shimmer h-3 w-40 rounded"></span>
              <span class="shimmer h-3 w-64 rounded"></span>
              <span class="shimmer h-3 w-52 rounded"></span>
            </div>
          </mad-device-frame>
        } @else {
          <div class="empty mx-auto mt-[8vh] flex w-full max-w-[560px] flex-col items-center text-center">
            <img src="brand/logo-mark.svg" width="48" height="48" alt="" class="mb-6 size-12 rounded-xl" />
            <h2 class="display text-step-3">Describe the app. Watch it assemble.</h2>
            <p class="mt-3 max-w-[440px] text-step--1 text-ink-3">Type a prompt below, pick a suggestion, or start from a blank canvas and drag components in.</p>
            <div class="mt-6 grid w-full gap-2 sm:grid-cols-2">
              @for (s of suggestions; track s.title) {
                <button type="button" class="suggestion panel group flex flex-col items-start gap-1.5 p-3.5 text-left" (click)="store.generate(s.prompt)" [disabled]="store.generating()">
                  <span class="flex items-center gap-2 text-[0.82rem] font-semibold"><mad-icon name="sparkles" [size]="13" class="text-ember" />{{ s.title }}</span>
                  <span class="text-[0.7rem] leading-snug text-ink-4">{{ s.prompt }}</span>
                </button>
              }
            </div>
            <button type="button" class="btn btn-ghost btn-sm mt-4 text-ink-3" (click)="store.startBlank()">
              <mad-icon name="plus" [size]="14" /> Start with a blank canvas
            </button>
            @if (store.mode() === 'offline') {
              @if (store.apiConfigured) {
                <p class="mt-4 inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-[0.7rem] text-warning"><mad-icon name="cloud-off" [size]="12" /> API offline. Builds will run in your browser and save locally.</p>
              } @else {
                <p class="mt-4 inline-flex items-center gap-1.5 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-[0.7rem] text-signal"><mad-icon name="cpu" [size]="12" /> Browser mode. Builds run in your browser and projects save locally.</p>
              }
            }
          </div>
        }
      </div>
    </div>

    <!-- frame meta -->
    @if (store.root()) {
      <div class="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-panel/80 px-3 py-1 text-[0.66rem] text-ink-3 backdrop-blur">
        <span class="mono">{{ vp().width }}×{{ vp().height }}</span> · {{ vp().label }} · {{ Math.round(scale() * 100) }}%
      </div>
    }
  `,
  styles: `
    .suggestion { transition: border-color 0.15s ease, transform 0.4s var(--ease-spring), background-color 0.15s ease; }
    .suggestion:hover { border-color: var(--mad-line-strong); background: var(--mad-raised); transform: translateY(-1px); }
    .empty { animation: empty-in 0.7s var(--ease-out-expo) both; }
    @keyframes empty-in { from { opacity: 0; transform: translateY(10px); } }
  `,
})
export class StudioCanvas {
  protected readonly store = inject(StudioStore);
  private readonly render = inject(RenderContext);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  protected readonly Math = Math;

  private readonly available = signal(1200);
  protected readonly vp = computed(() => DEVICE_VIEWPORTS[this.store.device()]);
  protected readonly scale = computed(() => {
    const z = this.store.zoom();
    if (z !== 'fit') return z;
    const fit = (this.available() - 64) / this.vp().width;
    return Math.max(0.2, Math.min(1, Math.round(fit * 100) / 100));
  });
  protected readonly frameWidth = computed(() => Math.round(this.vp().width * this.scale()));
  protected readonly urlLabel = computed(() => {
    const p = this.store.project();
    const fromName = this.store.projectName().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const slug = p?.slug ?? (fromName || 'preview');
    return `${slug}.preview.madproducts.app`;
  });

  protected readonly suggestions = [
    { title: 'CRM with billing and support', prompt: 'Build an internal CRM dashboard with Stripe billing and a customer support chat' },
    { title: 'Marketplace back office', prompt: 'Marketplace admin with product catalog, orders, inventory and Shopify sync' },
    { title: 'Team task board', prompt: 'Task board for a design team with sprints, roles and Slack notifications' },
    { title: 'Launch site', prompt: 'Landing page and waitlist for a coffee subscription with pricing' },
  ];

  constructor() {
    afterNextRender(() => {
      const el = this.scroller().nativeElement;
      const ro = new ResizeObserver(([entry]) => this.available.set(entry?.contentRect.width ?? el.clientWidth));
      ro.observe(el);
      this.available.set(el.clientWidth);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  protected onBackgroundClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('mad-node') || target.closest('button') || target.closest('a')) return;
    this.store.select(null);
    this.render.hover(null);
  }
}
