import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../core/ui/icon.component';
import { Magnetic } from '../core/motion/magnetic.directive';
import { ThemeService } from '../core/theme/theme.service';

/**
 * Floating, context-aware navigation. Expands at the top of the page and
 * condenses into a compact glass pill once the hero scrolls away.
 */
@Component({
  selector: 'mad-site-nav',
  imports: [RouterLink, Icon, Magnetic],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 pointer-events-none' },
  template: `
    <nav
      class="nav pointer-events-auto flex w-full items-center gap-2 rounded-2xl px-3 py-2 transition-[max-width,padding,background-color,box-shadow] duration-500"
      [class.is-condensed]="condensed()"
      [class.glass]="condensed()"
      [class.shadow-float]="condensed()"
      aria-label="Primary"
    >
      <a routerLink="/" class="flex items-center gap-2.5 rounded-lg pr-2 pl-1" aria-label="MAD Studio home">
        <img src="brand/logo-mark.svg" width="28" height="28" alt="" class="size-7" />
        <span class="font-display text-[1.05rem] font-bold tracking-tight">MAD<span class="ml-1 font-sans font-medium text-ink-3">Studio</span></span>
      </a>

      <div class="mx-auto hidden items-center gap-1 md:flex">
        @for (item of items; track item.href) {
          <a [href]="item.href" class="rounded-lg px-3 py-1.5 text-step--1 font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink">{{ item.label }}</a>
        }
      </div>

      <div class="ml-auto flex items-center gap-1.5 md:ml-0">
        <button type="button" class="btn btn-ghost btn-icon" [attr.aria-label]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'" (click)="theme.toggle()">
          <mad-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" [size]="16" />
        </button>
        <a href="https://github.com/madproducts" target="_blank" rel="noreferrer" class="btn btn-ghost btn-sm hidden sm:inline-flex">Docs</a>
        <a routerLink="/studio" madMagnetic class="btn btn-primary btn-sm">
          Open Studio
          <mad-icon name="arrow-right" [size]="14" />
        </a>
        <button type="button" class="btn btn-ghost btn-icon md:hidden" aria-label="Toggle menu" [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())">
          <mad-icon [name]="menuOpen() ? 'x' : 'menu'" [size]="18" />
        </button>
      </div>
    </nav>

    @if (menuOpen()) {
      <div class="glass pointer-events-auto absolute inset-x-4 top-[4.5rem] flex flex-col gap-1 rounded-2xl p-2 shadow-float md:hidden">
        @for (item of items; track item.href) {
          <a [href]="item.href" class="rounded-lg px-3 py-2.5 text-step-0 font-medium text-ink-2 hover:bg-hover hover:text-ink" (click)="menuOpen.set(false)">{{ item.label }}</a>
        }
      </div>
    }
  `,
  styles: `
    .nav { max-width: 1180px; border: 1px solid transparent; }
    .nav.is-condensed { max-width: 880px; padding-block: 0.4rem; }
  `,
})
export class SiteNav {
  protected readonly theme = inject(ThemeService);
  protected readonly condensed = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly items = [
    { label: 'Product', href: '#product' },
    { label: 'How it works', href: '#workflow' },
    { label: 'Libraries', href: '#libraries' },
    { label: 'Integrations', href: '#integrations' },
  ];

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const onScroll = () => this.condensed.set(window.scrollY > 48);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      this.destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
    });
  }
}
