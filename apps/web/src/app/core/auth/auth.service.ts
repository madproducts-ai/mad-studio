import { Injectable, computed, effect, inject, signal } from '@angular/core';
import type { AuthState } from '@mad/schema';
import { ApiClient, ApiRequestError } from '../api/api-client';
import { ToastService } from '../ui/toast.service';

export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated';
export type AuthDialogMode = 'sign-in' | 'create-account';

/**
 * Session state for the hosted API. The session itself is an HttpOnly cookie
 * the browser manages; this service only mirrors what `/auth/me` reports and
 * coordinates the sign-in dialog so any caller can `await requireSession()`
 * and continue once the user has signed in (or chosen browser mode).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);

  readonly state = signal<AuthState | null>(null);
  readonly status = signal<AuthStatus>(this.api.configured ? 'unknown' : 'anonymous');
  readonly user = computed(() => this.state()?.user ?? null);
  readonly workspace = computed(() => this.state()?.workspace ?? null);
  readonly initials = computed(() => {
    const name = this.user()?.displayName ?? '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts.length === 0 ? '?' : parts.length === 1 ? parts[0]!.slice(0, 2).toUpperCase() : `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
  });

  /** Sign-in dialog coordination. */
  readonly dialogOpen = signal(false);
  readonly dialogMode = signal<AuthDialogMode>('sign-in');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  private waiters: Array<(signedIn: boolean) => void> = [];
  private refreshing: Promise<AuthState | null> | null = null;
  private lastSessionLost = this.api.sessionLost();

  constructor() {
    effect(() => {
      const lost = this.api.sessionLost();
      if (lost === this.lastSessionLost) return;
      this.lastSessionLost = lost;
      if (this.status() === 'authenticated') {
        this.state.set(null);
        this.status.set('anonymous');
        this.toast.info('Signed out', 'Your session ended. Sign in again to keep working in the cloud.');
      }
    });
  }

  /** Reconciles with the server. Safe to call often; concurrent calls share one request. */
  refresh(): Promise<AuthState | null> {
    if (!this.api.configured) return Promise.resolve(null);
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const state = await this.api.me();
        this.state.set(state);
        this.status.set('authenticated');
        return state;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          this.state.set(null);
          this.status.set('anonymous');
        }
        return null;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /**
   * Resolves true once a session exists. Opens the dialog when needed; a
   * dismissed dialog resolves false so callers can continue in browser mode.
   */
  async requireSession(mode: AuthDialogMode = 'sign-in'): Promise<boolean> {
    if (this.status() === 'authenticated') return true;
    if (this.status() === 'unknown') {
      await this.refresh();
      if (this.status() === 'authenticated') return true;
    }
    this.dialogMode.set(mode);
    this.error.set(null);
    this.dialogOpen.set(true);
    return new Promise<boolean>((resolve) => this.waiters.push(resolve));
  }

  async signIn(email: string, password: string): Promise<boolean> {
    return this.submit(() => this.api.login({ email, password }));
  }

  async createAccount(email: string, password: string, displayName: string): Promise<boolean> {
    return this.submit(() => this.api.register({ email, password, displayName }));
  }

  /** The user chose to continue without an account. */
  dismissDialog(): void {
    this.dialogOpen.set(false);
    this.error.set(null);
    this.settle(false);
  }

  async signOut(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // The cookie may already be gone; local state is cleared regardless.
    }
    this.state.set(null);
    this.status.set('anonymous');
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<number> {
    const result = await this.api.changePassword({ currentPassword, newPassword });
    return result.revokedSessions;
  }

  private async submit(op: () => Promise<AuthState>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    try {
      const state = await op();
      this.state.set(state);
      this.status.set('authenticated');
      this.dialogOpen.set(false);
      this.settle(true);
      return true;
    } catch (error) {
      this.error.set(this.describe(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private settle(signedIn: boolean): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w(signedIn));
  }

  private describe(error: unknown): string {
    if (error instanceof ApiRequestError) {
      switch (error.code) {
        case 'invalid_credentials':
          return 'That email and password do not match.';
        case 'email_taken':
          return 'An account with this email already exists. Sign in instead.';
        case 'rate_limited':
          return 'Too many attempts. Wait a moment and try again.';
        case 'validation_failed': {
          const first = Array.isArray(error.error.details) ? (error.error.details[0] as { path?: string; message?: string } | undefined) : undefined;
          return first?.message ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Check the form and try again.';
        }
        default:
          return error.message;
      }
    }
    return error instanceof Error ? error.message : 'Something went wrong. Try again.';
  }
}
