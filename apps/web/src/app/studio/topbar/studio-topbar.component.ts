import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DesignSystem, Device } from '@mad/schema';
import { Icon, type IconName } from '../../core/ui/icon.component';
import { ThemeService } from '../../core/theme/theme.service';
import { ToastService } from '../../core/ui/toast.service';
import { StudioStore } from '../state/studio.store';

@Component({
  selector: 'mad-studio-topbar',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-11 items-center gap-2 border-b border-line bg-panel px-2' },
  template: `
    <a routerLink="/" class="flex size-8 items-center justify-center rounded-lg hover:bg-hover" aria-label="Back to home">
      <img src="brand/logo-mark.svg" width="22" height="22" alt="" class="size-[22px] rounded-md" />
    </a>
    <span class="text-line-strong">/</span>
    <div class="flex min-w-0 items-center gap-2">
      <input
        class="project-name min-w-[6ch] max-w-[26ch] rounded-md bg-transparent px-1.5 py-1 text-step--1 font-semibold text-ink outline-none hover:bg-hover focus:bg-raised focus:ring-1 focus:ring-signal"
        [value]="store.projectName()"
        [style.width.ch]="Math.min(26, Math.max(6, store.projectName().length + 1))"
        aria-label="Project name"
        spellcheck="false"
        (change)="rename($any($event.target).value)"
        (keydown.enter)="$any($event.target).blur()"
      />
      <span class="status inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium" [attr.data-state]="saveLabel().tone">
        <i class="size-1.5 rounded-full" [class.pulse-dot]="saveLabel().pulse"></i>
        {{ saveLabel().text }}
      </span>
      @if (store.mode() === 'offline') {
        @if (store.apiConfigured) {
          <span class="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[0.68rem] font-medium text-warning" title="The API is unreachable. Builds run in your browser and save locally.">
            <mad-icon name="cloud-off" [size]="11" /> Offline
          </span>
        } @else {
          <span class="inline-flex items-center gap-1 rounded-full border border-signal/40 bg-signal/10 px-2 py-0.5 text-[0.68rem] font-medium text-signal" title="This build has no API attached. Builds run in your browser and projects save locally.">
            <mad-icon name="cpu" [size]="11" /> Browser mode
          </span>
        }
      }
    </div>

    <div class="mx-auto flex items-center gap-1">
      <div role="group" aria-label="Device" class="flex items-center gap-0.5 rounded-lg border border-line bg-bg p-0.5">
        @for (d of devices; track d.id) {
          <button type="button" class="seg" [class.is-active]="store.device() === d.id" [attr.aria-pressed]="store.device() === d.id" [attr.aria-label]="d.label" [title]="d.label + ' (' + d.key + ')'" (click)="store.device.set(d.id)">
            <mad-icon [name]="d.icon" [size]="15" />
          </button>
        }
      </div>
      <div role="group" aria-label="Zoom" class="ml-1 flex items-center gap-0.5 rounded-lg border border-line bg-bg p-0.5">
        <button type="button" class="seg" aria-label="Zoom out" (click)="zoomBy(-0.1)"><mad-icon name="zoom-out" [size]="15" /></button>
        <button type="button" class="seg mono min-w-[4.2ch] text-[0.7rem]" aria-label="Fit to view" (click)="store.zoom.set('fit')">{{ zoomLabel() }}</button>
        <button type="button" class="seg" aria-label="Zoom in" (click)="zoomBy(0.1)"><mad-icon name="zoom-in" [size]="15" /></button>
      </div>
      <div class="ml-1 flex items-center gap-0.5 rounded-lg border border-line bg-bg p-0.5">
        <button type="button" class="seg" [attr.aria-label]="store.previewTheme() === 'dark' ? 'Preview in light theme' : 'Preview in dark theme'" (click)="store.previewTheme.update(t => t === 'dark' ? 'light' : 'dark')">
          <mad-icon [name]="store.previewTheme() === 'dark' ? 'sun' : 'moon'" [size]="15" />
        </button>
        <label class="seg relative gap-1 pr-5 text-[0.72rem]">
          <mad-icon name="layers" [size]="14" />
          <select class="absolute inset-0 cursor-pointer appearance-none bg-transparent opacity-0" aria-label="Design system" [value]="store.designSystem()" (change)="store.setDesignSystem($any($event.target).value)">
            @for (ds of systems; track ds.id) {
              <option [value]="ds.id">{{ ds.label }}</option>
            }
          </select>
          <span>{{ systemLabel() }}</span>
          <mad-icon name="chevron-down" [size]="12" class="absolute right-1 text-ink-4" />
        </label>
      </div>
    </div>

    <div class="flex items-center gap-1">
      <button type="button" class="btn btn-ghost btn-icon" [disabled]="!store.canUndo()" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" (click)="store.undo()"><mad-icon name="undo" [size]="15" /></button>
      <button type="button" class="btn btn-ghost btn-icon" [disabled]="!store.canRedo()" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" (click)="store.redo()"><mad-icon name="redo" [size]="15" /></button>
      <span class="mx-1 h-5 w-px bg-line"></span>
      <button type="button" class="btn btn-ghost btn-icon" aria-label="Toggle studio theme" (click)="theme.toggle()"><mad-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" [size]="15" /></button>
      <button type="button" class="btn btn-ghost btn-sm gap-1.5" (click)="share()" [disabled]="!store.projectId()"><mad-icon name="copy" [size]="14" /> Share</button>
      <div class="relative">
        <button type="button" class="btn btn-primary btn-sm gap-1.5" [disabled]="!store.root() || store.deploying() || store.generating()" (click)="deployOpen.set(!deployOpen())" [attr.aria-expanded]="deployOpen()">
          @if (store.deploying()) {
            <mad-icon name="loader" [size]="14" class="animate-spin" /> Deploying
          } @else {
            <mad-icon name="rocket" [size]="14" /> Deploy <mad-icon name="chevron-down" [size]="12" />
          }
        </button>
        @if (deployOpen()) {
          <div class="menu glass absolute right-0 top-[calc(100%+6px)] z-40 w-64 rounded-xl p-1.5 shadow-float" (pointerleave)="deployOpen.set(false)">
            <button type="button" class="menu-item" (click)="deploy('preview')">
              <mad-icon name="eye" [size]="14" />
              <span><b>Preview</b><small>Shareable URL, expires in 7 days</small></span>
            </button>
            <button type="button" class="menu-item" (click)="deploy('production')">
              <mad-icon name="globe" [size]="14" />
              <span><b>Production</b><small>{{ store.project()?.slug || 'project' }}.madproducts.app</small></span>
            </button>
            @if (store.deployments().length) {
              <div class="my-1 h-px bg-line"></div>
              @for (d of store.deployments().slice(0, 3); track d.id) {
                <a class="menu-item" [href]="d.url || '#'" target="_blank" rel="noreferrer">
                  <i class="size-1.5 rounded-full" [class.bg-success]="d.status === 'live'" [class.bg-warning]="d.status === 'building' || d.status === 'queued'" [class.bg-danger]="d.status === 'failed'"></i>
                  <span><b class="capitalize">{{ d.target }} · v{{ d.documentVersion }}</b><small class="mono">{{ d.url ? d.url.replace('https://', '') : d.status }}</small></span>
                </a>
              }
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .seg { display: inline-flex; align-items: center; justify-content: center; height: 26px; min-width: 26px; padding: 0 5px; border-radius: 6px; color: var(--mad-ink-3); transition: background-color 0.15s ease, color 0.15s ease; }
    .seg:hover { background: var(--mad-hover); color: var(--mad-ink); }
    .seg.is-active { background: var(--mad-raised); color: var(--mad-ink); box-shadow: inset 0 0 0 1px var(--mad-line-strong); }
    .status i { background: var(--mad-ink-4); }
    .status { border-color: var(--mad-line); color: var(--mad-ink-3); }
    .status[data-state='saved'] i { background: var(--mad-success); }
    .status[data-state='saving'] i, .status[data-state='dirty'] i { background: var(--mad-warning); }
    .status[data-state='error'] { border-color: color-mix(in oklab, var(--mad-danger) 40%, transparent); color: var(--mad-danger); }
    .status[data-state='error'] i { background: var(--mad-danger); }
    .menu-item { display: flex; width: 100%; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; text-align: left; color: var(--mad-ink-2); }
    .menu-item:hover { background: var(--mad-hover); color: var(--mad-ink); }
    .menu-item span { display: flex; flex-direction: column; line-height: 1.2; }
    .menu-item b { font-size: 0.8rem; font-weight: 600; }
    .menu-item small { font-size: 0.68rem; color: var(--mad-ink-4); }
    .menu { animation: menu-in 0.35s var(--ease-spring) both; transform-origin: top right; }
    @keyframes menu-in { from { opacity: 0; transform: scale(0.96) translateY(-4px); } }
  `,
})
export class StudioTopbar {
  protected readonly store = inject(StudioStore);
  protected readonly theme = inject(ThemeService);
  private readonly toast = inject(ToastService);
  protected readonly Math = Math;
  protected readonly deployOpen = signal(false);

  protected readonly devices: ReadonlyArray<{ id: Device; label: string; icon: IconName; key: string }> = [
    { id: 'desktop', label: 'Desktop 1440', icon: 'monitor', key: '1' },
    { id: 'tablet', label: 'iPad Pro 11"', icon: 'tablet', key: '2' },
    { id: 'iphone', label: 'iPhone 15 Pro', icon: 'smartphone', key: '3' },
    { id: 'android', label: 'Pixel 8', icon: 'phone-android', key: '4' },
  ];
  protected readonly systems: ReadonlyArray<{ id: DesignSystem; label: string }> = [
    { id: 'tailwind', label: 'Tailwind' },
    { id: 'material', label: 'Material' },
    { id: 'wordpress', label: 'WordPress' },
  ];
  protected readonly systemLabel = computed(() => this.systems.find((s) => s.id === this.store.designSystem())?.label ?? 'Tailwind');
  protected readonly zoomLabel = computed(() => {
    const z = this.store.zoom();
    return z === 'fit' ? 'Fit' : `${Math.round(z * 100)}%`;
  });
  protected readonly saveLabel = computed<{ text: string; tone: string; pulse: boolean }>(() => {
    switch (this.store.saveState()) {
      case 'saving':
        return { text: 'Saving', tone: 'saving', pulse: true };
      case 'dirty':
        return { text: 'Unsaved', tone: 'dirty', pulse: false };
      case 'saved':
        return { text: this.store.isLocal() ? 'Saved locally' : `Saved · v${this.store.documentVersion()}`, tone: 'saved', pulse: false };
      case 'conflict':
        return { text: 'Conflict', tone: 'error', pulse: false };
      case 'error':
        return { text: 'Save failed', tone: 'error', pulse: false };
      default:
        return { text: this.store.generating() ? 'Building' : 'Draft', tone: 'idle', pulse: this.store.generating() };
    }
  });

  protected rename(value: string): void {
    void this.store.renameProject(value);
  }

  protected zoomBy(delta: number): void {
    const current = this.store.zoom();
    const base = current === 'fit' ? 0.5 : current;
    this.store.zoom.set(Math.min(1.5, Math.max(0.2, Math.round((base + delta) * 20) / 20)));
  }

  protected async share(): Promise<void> {
    const url = `${location.origin}/studio/${this.store.projectId() ?? ''}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Link copied', this.store.isLocal() ? 'Local projects only open in this browser.' : url);
    } catch {
      this.toast.info('Share link', url);
    }
  }

  protected deploy(target: 'preview' | 'production'): void {
    this.deployOpen.set(false);
    void this.store.deploy(target);
  }
}
