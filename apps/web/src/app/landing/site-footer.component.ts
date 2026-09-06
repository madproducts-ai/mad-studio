import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../core/ui/icon.component';
import { ThemeService } from '../core/theme/theme.service';

@Component({
  selector: 'mad-site-footer',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block border-t border-line bg-panel/40' },
  template: `
    <footer class="mx-auto max-w-[1180px] px-5 py-14 sm:px-8">
      <div class="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div class="flex flex-col gap-4">
          <a routerLink="/" class="flex items-center gap-2.5" aria-label="MAD Studio home">
            <img src="brand/logo-mark.svg" width="32" height="32" alt="" class="size-8" />
            <span class="font-display text-step-1 font-bold tracking-tight">MAD<span class="ml-1 font-sans font-medium text-ink-3">Studio</span></span>
          </a>
          <p class="max-w-xs text-step--1 leading-relaxed text-ink-3">The AI-native platform to generate, visually edit, and deploy production-ready web and mobile applications.</p>
          <div class="mt-1 flex items-center gap-2 text-step--2 text-ink-3">
            <span class="inline-flex size-2 rounded-full bg-success"></span>
            All systems operational
            <span class="mx-1 text-line-strong">·</span>
            <span class="mono">studio.madproducts.ai</span>
          </div>
        </div>

        @for (col of columns; track col.title) {
          <nav [attr.aria-label]="col.title" class="flex flex-col gap-2.5">
            <p class="eyebrow mb-1 text-[0.62rem]">{{ col.title }}</p>
            @for (link of col.links; track link.label) {
              <a [href]="link.href" class="text-step--1 text-ink-2 transition-colors hover:text-ink">{{ link.label }}</a>
            }
          </nav>
        }
      </div>

      <div class="hairline my-10"></div>

      <div class="flex flex-col-reverse items-start justify-between gap-4 text-step--2 text-ink-4 sm:flex-row sm:items-center">
        <p>© {{ year }} MAD Products. Built in Cape Town. All rights reserved.</p>
        <div class="flex items-center gap-3">
          <a href="#" class="hover:text-ink-2">Privacy</a>
          <a href="#" class="hover:text-ink-2">Terms</a>
          <a href="#" class="hover:text-ink-2">Security</a>
          <button type="button" class="btn btn-ghost btn-sm -my-2 gap-1.5" (click)="theme.toggle()">
            <mad-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" [size]="14" />
            {{ theme.theme() === 'dark' ? 'Light' : 'Dark' }} theme
          </button>
        </div>
      </div>
    </footer>
  `,
})
export class SiteFooter {
  protected readonly theme = inject(ThemeService);
  protected readonly year = new Date().getFullYear();
  protected readonly columns = [
    { title: 'Product', links: [{ label: 'Studio', href: '/studio' }, { label: 'Component libraries', href: '#libraries' }, { label: 'Integrations', href: '#integrations' }, { label: 'Deploy', href: '#workflow' }, { label: 'Changelog', href: '#' }] },
    { title: 'Developers', links: [{ label: 'Documentation', href: '#' }, { label: 'API reference', href: '#' }, { label: 'Schema format', href: '#' }, { label: 'CLI', href: '#' }, { label: 'Status', href: '#' }] },
    { title: 'Company', links: [{ label: 'About MAD Products', href: '#' }, { label: 'Customers', href: '#' }, { label: 'Careers', href: '#' }, { label: 'Press kit', href: '#' }, { label: 'Contact', href: 'mailto:hello@madproducts.ai' }] },
    { title: 'Resources', links: [{ label: 'Guides', href: '#' }, { label: 'Templates', href: '#' }, { label: 'Community', href: '#' }, { label: 'Support', href: '#' }, { label: 'Brand', href: '#' }] },
  ];
}
