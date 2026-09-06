import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import type { DesignSystem, MadNode } from '@mad/schema';
import { createIdFactory } from '@mad/schema';
import { badge, button, card, chart, grid, input, row, stack, stat, table, toggle, type BuildContext } from '@mad/planner';
import { DeviceFrame } from '../core/render/device-frame.component';
import { RenderContext } from '../core/render/render-context';

/**
 * Same document, three skins. Proves the design-system switch is a token swap,
 * not a rebuild.
 */
@Component({
  selector: 'mad-library-showcase',
  imports: [DeviceFrame],
  providers: [RenderContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Design system" class="inline-flex gap-1 rounded-xl border border-line bg-panel p-1">
        @for (ds of systems; track ds.id) {
          <button
            type="button"
            role="tab"
            class="rounded-lg px-3.5 py-1.5 text-step--1 font-medium transition-colors"
            [class.bg-raised]="active() === ds.id"
            [class.text-ink]="active() === ds.id"
            [class.text-ink-3]="active() !== ds.id"
            [attr.aria-selected]="active() === ds.id"
            (click)="active.set(ds.id)"
          >
            {{ ds.label }}
          </button>
        }
      </div>
      <div role="group" aria-label="Preview theme" class="inline-flex gap-1 rounded-xl border border-line bg-panel p-1">
        <button type="button" class="rounded-lg px-3 py-1.5 text-step--1 font-medium" [class.bg-raised]="theme() === 'dark'" [class.text-ink-3]="theme() !== 'dark'" (click)="theme.set('dark')">Dark</button>
        <button type="button" class="rounded-lg px-3 py-1.5 text-step--1 font-medium" [class.bg-raised]="theme() === 'light'" [class.text-ink-3]="theme() !== 'light'" (click)="theme.set('light')">Light</button>
      </div>
    </div>

    <div class="relative overflow-hidden rounded-2xl border border-line bg-bg p-3 sm:p-5">
      <div class="absolute inset-0 dot-bg opacity-50"></div>
      <div class="relative overflow-x-auto">
        <div class="mx-auto w-max">
          <mad-device-frame [root]="doc()" device="tablet" [designSystem]="active()" [theme]="theme()" [scale]="0.62" />
        </div>
      </div>
    </div>
    <p class="mt-3 text-center text-step--1 text-ink-3">{{ activeMeta().blurb }}</p>
  `,
})
export class LibraryShowcase {
  protected readonly systems: ReadonlyArray<{ id: DesignSystem; label: string; blurb: string }> = [
    { id: 'tailwind', label: 'Tailwind', blurb: 'Utility-first tokens, hairline borders, editorial type. The MAD default.' },
    { id: 'material', label: 'Material', blurb: 'Material 3 shapes and tonal surfaces. Rounded, elevated, familiar on Android.' },
    { id: 'wordpress', label: 'WordPress', blurb: 'Admin-style density with compact radii. Drops straight into a wp-admin theme.' },
  ];
  protected readonly active = signal<DesignSystem>('tailwind');
  protected readonly theme = signal<'dark' | 'light'>('dark');
  protected readonly activeMeta = computed(() => this.systems.find((s) => s.id === this.active()) ?? this.systems[0]!);

  protected readonly doc = computed<MadNode>(() => {
    const ctx: BuildContext = { nextId: createIdFactory(7), designSystem: this.active(), random: (() => { let s = 11; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })() };
    return {
      id: 'n_showcase00',
      type: 'page',
      name: 'Showcase',
      props: { title: 'Showcase', layout: 'centered' },
      style: {},
      source: 'preset',
      locked: false,
      children: [
        {
          id: 'n_showcase01',
          type: 'nav',
          name: 'Nav',
          props: { brand: 'Northwind', links: ['Overview', 'Customers', 'Billing'], cta: 'Invite team', sticky: true },
          style: {},
          source: 'preset',
          locked: false,
          children: [],
        },
        stack(ctx, 'Main', [
          row(ctx, 'Toolbar', [input(ctx, '', 'Search customers…', 'search'), row(ctx, 'Actions', [badge(ctx, '12 trials ending', 'warning'), button(ctx, 'New customer', 'primary', 'plus')], { justify: 'end' })]),
          grid(ctx, 'KPIs', 3, [stat(ctx, 'MRR', '$84.2k', '+6.1%', 'up'), stat(ctx, 'Active customers', '1,284', '+3.4%', 'up'), stat(ctx, 'Churn (30d)', '1.2%', '-0.3%', 'down')]),
          grid(ctx, 'Detail', 3, [chart(ctx, 'Revenue, trailing 12 months', 'area', ['MRR', 'New'], 12), card(ctx, 'Notifications', [toggle(ctx, 'Email digests', true), toggle(ctx, 'Slack alerts', true), toggle(ctx, 'SMS', false)])]),
          table(ctx, 'Customers', ['Name', 'Company', 'Plan', 'Status', 'MRR'], 5),
        ], { padding: { top: 24, right: 24, bottom: 40, left: 24 }, gap: 20 }),
      ],
    };
  });
}
