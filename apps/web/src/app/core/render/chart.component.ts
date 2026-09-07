import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CHART_H, CHART_W, chartBars, chartDonut, chartLayers, type ChartKind } from '@mad/export';

/**
 * Dependency-free SVG charts. Geometry comes from @mad/export (seeded from the
 * node id), so the canvas and the deployed page draw the same chart.
 */
@Component({
  selector: 'mad-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full' },
  template: `
    @if (kind() === 'donut') {
      <div class="flex items-center gap-5">
        <svg [attr.viewBox]="'0 0 120 120'" class="size-28 shrink-0 -rotate-90">
          @for (s of donut(); track s.label) {
            <circle cx="60" cy="60" r="46" fill="none" [attr.stroke]="s.color" stroke-width="16" [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset" class="donut-seg" />
          }
        </svg>
        <ul class="m-0 grid list-none gap-2 p-0 text-[0.78em]">
          @for (s of donut(); track s.label) {
            <li class="flex items-center gap-2">
              <span class="size-2 rounded-full" [style.background]="s.color"></span>
              <span class="text-[color:var(--r-ink-2)]">{{ s.label }}</span>
              <span class="mono ml-auto pl-4 text-[color:var(--r-ink)]">{{ s.pct }}%</span>
            </li>
          }
        </ul>
      </div>
    } @else {
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" class="block h-32 w-full overflow-visible">
        <defs>
          @for (l of layers(); track $index) {
            <linearGradient [attr.id]="'g' + uid + $index" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" [attr.stop-color]="l.color" stop-opacity="0.35" />
              <stop offset="1" [attr.stop-color]="l.color" stop-opacity="0" />
            </linearGradient>
          }
        </defs>
        @for (y of [0.25, 0.5, 0.75]; track y) {
          <line x1="0" [attr.y1]="H * y" [attr.x2]="W" [attr.y2]="H * y" stroke="var(--r-line)" stroke-dasharray="2 4" />
        }
        @if (kind() === 'bar') {
          @for (b of bars(); track $index) {
            <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="b.color" rx="2" class="bar" [style.--i]="$index" />
          }
        } @else {
          @for (l of layers(); track $index) {
            @if (kind() === 'area') {
              <path [attr.d]="l.area" [attr.fill]="'url(#g' + uid + $index + ')'" />
            }
            <path [attr.d]="l.path" fill="none" [attr.stroke]="l.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" class="line" />
          }
        }
      </svg>
      <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.72em] text-[color:var(--r-ink-3)]">
        @for (l of layers(); track $index) {
          <span class="inline-flex items-center gap-1.5"><span class="h-0.5 w-3 rounded-full" [style.background]="l.color"></span>{{ labels()[$index] }}</span>
        }
      </div>
    }
  `,
  styles: `
    .line { stroke-dasharray: 1000; stroke-dashoffset: 1000; animation: draw 1.4s var(--ease-out-expo) forwards; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    .bar { transform-origin: bottom; transform-box: fill-box; animation: grow 0.7s var(--ease-out-expo) both; animation-delay: calc(var(--i) * 40ms); }
    @keyframes grow { from { transform: scaleY(0); } }
    .donut-seg { transition: stroke-dashoffset 0.8s var(--ease-out-expo); }
    @media (prefers-reduced-motion: reduce) { .line, .bar { animation: none; stroke-dashoffset: 0; } }
  `,
})
export class Chart {
  readonly seed = input.required<string>();
  readonly kind = input<ChartKind>('line');
  readonly labels = input<string[]>(['Series A']);
  readonly points = input<number>(12);

  protected readonly W = CHART_W;
  protected readonly H = CHART_H;
  protected readonly uid = Math.random().toString(36).slice(2, 7);

  protected readonly layers = computed(() => chartLayers(this.seed(), this.labels(), this.points()));
  protected readonly bars = computed(() => chartBars(this.seed(), this.points(), this.labels().length));
  protected readonly donut = computed(() => chartDonut(this.seed(), this.labels()));
}
