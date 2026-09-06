import { ChangeDetectionStrategy, Component, ElementRef, HostListener, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { Icon } from '../../core/ui/icon.component';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Sign-in / create-account sheet shown over the studio when a cloud action
 * needs a session. Dismissing it is a first-class choice: the studio keeps
 * working in browser mode with local projects.
 */
@Component({
  selector: 'mad-auth-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fixed inset-0 z-[60] grid place-items-center p-4', role: 'presentation' },
  template: `
    <div class="backdrop absolute inset-0" (click)="auth.dismissDialog()"></div>
    <section class="sheet glass relative w-full max-w-[420px] rounded-2xl p-6 shadow-float" role="dialog" aria-modal="true" [attr.aria-labelledby]="'auth-title'">
      <header class="mb-5 flex items-start gap-3">
        <img src="brand/logo-mark.svg" width="36" height="36" alt="" class="size-9 rounded-xl" />
        <div class="min-w-0">
          <h2 id="auth-title" class="text-step-1 font-semibold tracking-tight text-ink">{{ isCreate() ? 'Create your account' : 'Sign in to MAD Studio' }}</h2>
          <p class="mt-0.5 text-step--1 text-ink-3">{{ isCreate() ? 'Save projects to your workspace, share links and deploy to the fleet.' : 'Your projects, versions and deployments live in your workspace.' }}</p>
        </div>
      </header>

      <div role="tablist" aria-label="Sign in or create an account" class="mb-4 grid grid-cols-2 gap-0.5 rounded-lg border border-line bg-bg p-0.5">
        <button type="button" role="tab" class="tab" [class.is-active]="!isCreate()" [attr.aria-selected]="!isCreate()" (click)="setMode('sign-in')">Sign in</button>
        <button type="button" role="tab" class="tab" [class.is-active]="isCreate()" [attr.aria-selected]="isCreate()" (click)="setMode('create-account')">Create account</button>
      </div>

      <form class="grid gap-3" (submit)="submit($event)" novalidate>
        @if (isCreate()) {
          <label class="grid gap-1">
            <span class="label">Your name</span>
            <input #nameField class="field" type="text" name="name" autocomplete="name" maxlength="80" required [value]="name()" (input)="name.set($any($event.target).value)" placeholder="Ada Lovelace" />
          </label>
        }
        <label class="grid gap-1">
          <span class="label">Email</span>
          <input #emailField class="field" type="email" name="email" autocomplete="email" inputmode="email" maxlength="200" required [value]="email()" (input)="email.set($any($event.target).value)" placeholder="you@company.com" />
        </label>
        <label class="grid gap-1">
          <span class="label flex items-center justify-between">
            Password
            @if (isCreate()) {
              <span class="text-[0.68rem] font-normal text-ink-4">At least 10 characters</span>
            }
          </span>
          <span class="relative">
            <input
              class="field w-full pr-10"
              [type]="showPassword() ? 'text' : 'password'"
              name="password"
              [attr.autocomplete]="isCreate() ? 'new-password' : 'current-password'"
              [attr.minlength]="isCreate() ? 10 : null"
              maxlength="200"
              required
              [value]="password()"
              (input)="password.set($any($event.target).value)"
              placeholder="••••••••••"
            />
            <button type="button" class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-4 hover:bg-hover hover:text-ink" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'" (click)="showPassword.update(v => !v)">
              <mad-icon [name]="showPassword() ? 'eye-off' : 'eye'" [size]="15" />
            </button>
          </span>
        </label>

        @if (auth.error(); as message) {
          <p class="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-step--1 text-danger" role="alert">
            <mad-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0" /> {{ message }}
          </p>
        }

        <button type="submit" class="btn btn-primary mt-1 w-full justify-center gap-2" [disabled]="auth.busy() || !canSubmit()">
          @if (auth.busy()) {
            <mad-icon name="loader" [size]="15" class="animate-spin" /> {{ isCreate() ? 'Creating account' : 'Signing in' }}
          } @else {
            <mad-icon name="shield-check" [size]="15" /> {{ isCreate() ? 'Create account' : 'Sign in' }}
          }
        </button>
      </form>

      <footer class="mt-5 flex flex-col items-center gap-1 border-t border-line pt-4 text-center">
        <button type="button" class="btn btn-ghost btn-sm gap-1.5" (click)="auth.dismissDialog()">
          <mad-icon name="cpu" [size]="14" /> Continue in browser mode
        </button>
        <p class="text-[0.7rem] text-ink-4">Builds run in your browser and projects save on this device only.</p>
      </footer>
    </section>
  `,
  styles: `
    .backdrop { background: color-mix(in oklab, var(--mad-bg) 70%, transparent); backdrop-filter: blur(6px); animation: fade-in 0.25s ease both; }
    .sheet { animation: sheet-in 0.45s var(--ease-spring) both; }
    .tab { height: 30px; border-radius: 6px; font-size: 0.78rem; font-weight: 600; color: var(--mad-ink-3); transition: background-color 0.15s ease, color 0.15s ease; }
    .tab:hover { color: var(--mad-ink); }
    .tab.is-active { background: var(--mad-raised); color: var(--mad-ink); box-shadow: inset 0 0 0 1px var(--mad-line-strong); }
    .label { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.01em; color: var(--mad-ink-2); }
    @keyframes fade-in { from { opacity: 0; } }
    @keyframes sheet-in { from { opacity: 0; transform: translateY(12px) scale(0.98); } }
  `,
})
export class AuthDialog {
  protected readonly auth = inject(AuthService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly emailField = viewChild<ElementRef<HTMLInputElement>>('emailField');
  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameField');

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly isCreate = computed(() => this.auth.dialogMode() === 'create-account');
  protected readonly canSubmit = computed(() => {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim());
    if (!emailOk || this.password().length === 0) return false;
    return this.isCreate() ? this.name().trim().length > 0 && this.password().length >= 10 : true;
  });

  constructor() {
    afterNextRender(() => (this.isCreate() ? this.nameField() : this.emailField())?.nativeElement.focus());
  }

  protected setMode(mode: 'sign-in' | 'create-account'): void {
    this.auth.dialogMode.set(mode);
    this.auth.error.set(null);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit()) return;
    const email = this.email().trim();
    const ok = this.isCreate() ? await this.auth.createAccount(email, this.password(), this.name().trim()) : await this.auth.signIn(email, this.password());
    if (ok) this.password.set('');
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.auth.busy()) this.auth.dismissDialog();
  }

  @HostListener('keydown', ['$event'])
  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
