import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from './icon.component';
import { ToastService } from './toast.service';

@Component({
  selector: 'mad-toast-host',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-5' },
  template: `
    <div role="region" aria-live="polite" aria-label="Notifications" class="contents">
      @for (t of toasts.toasts(); track t.id) {
        <div
          class="pointer-events-auto glass toast flex w-full max-w-sm items-start gap-3 rounded-[var(--radius-lg)] px-3.5 py-3 shadow-float"
          [attr.data-tone]="t.tone"
        >
          <span class="toast-dot mt-1.5 size-2 shrink-0 rounded-full"></span>
          <div class="min-w-0 flex-1">
            <p class="text-step--1 font-semibold leading-tight">{{ t.title }}</p>
            @if (t.detail) {
              <p class="mt-0.5 text-step--2 leading-snug text-ink-3">{{ t.detail }}</p>
            }
            @if (t.action; as a) {
              <button type="button" class="btn btn-ghost btn-sm mt-2 -ml-2 text-signal" (click)="a.run(); toasts.dismiss(t.id)">{{ a.label }}</button>
            }
          </div>
          <button type="button" class="btn btn-ghost btn-icon -mr-1 -mt-1 size-7" aria-label="Dismiss notification" (click)="toasts.dismiss(t.id)">
            <mad-icon name="x" [size]="14" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toast {
      animation: toast-in 0.55s var(--ease-spring) both;
    }
    .toast[data-tone='info'] .toast-dot { background: var(--mad-signal); }
    .toast[data-tone='success'] .toast-dot { background: var(--mad-success); }
    .toast[data-tone='danger'] .toast-dot { background: var(--mad-danger); }
    .toast[data-tone='warning'] .toast-dot { background: var(--mad-warning); }
    @keyframes toast-in {
      from { opacity: 0; transform: translateY(14px) scale(0.98); }
      to { opacity: 1; transform: none; }
    }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);
}
