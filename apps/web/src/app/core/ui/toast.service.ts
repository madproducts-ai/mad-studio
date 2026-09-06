import { Injectable, signal } from '@angular/core';

export type ToastTone = 'info' | 'success' | 'danger' | 'warning';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
  timeoutMs: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  readonly toasts = signal<Toast[]>([]);

  show(input: Omit<Toast, 'id' | 'timeoutMs'> & { timeoutMs?: number }): number {
    const id = ++this.seq;
    const toast: Toast = { id, timeoutMs: input.tone === 'danger' ? 9000 : 4500, ...input };
    this.toasts.update((list) => [...list.slice(-3), toast]);
    if (toast.timeoutMs > 0) setTimeout(() => this.dismiss(id), toast.timeoutMs);
    return id;
  }

  info(title: string, detail?: string): number {
    return this.show({ tone: 'info', title, ...(detail !== undefined ? { detail } : {}) });
  }
  success(title: string, detail?: string, action?: Toast['action']): number {
    return this.show({ tone: 'success', title, ...(detail !== undefined ? { detail } : {}), ...(action ? { action } : {}) });
  }
  error(title: string, detail?: string, action?: Toast['action']): number {
    return this.show({ tone: 'danger', title, ...(detail !== undefined ? { detail } : {}), ...(action ? { action } : {}) });
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
