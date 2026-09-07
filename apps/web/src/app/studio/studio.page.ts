import { ChangeDetectionStrategy, Component, ElementRef, HostListener, effect, inject, input, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { StudioStore } from './state/studio.store';
import { StudioTopbar } from './topbar/studio-topbar.component';
import { LeftRail } from './rail/left-rail.component';
import { StudioCanvas } from './canvas/studio-canvas.component';
import { InspectorPanel } from './inspector/inspector-panel.component';
import { PromptBar } from './prompt/prompt-bar.component';
import { AuthDialog } from './auth/auth-dialog.component';
import { AuthService } from '../core/auth/auth.service';

/**
 * The IDE. Owns the store and render context for one project session, routes
 * keyboard shortcuts, and lays out topbar / rail / canvas / inspector / prompt.
 */
@Component({
  selector: 'mad-studio',
  imports: [StudioTopbar, LeftRail, StudioCanvas, InspectorPanel, PromptBar, AuthDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'studio fixed inset-0 grid bg-bg text-ink', '[class.has-inspector]': 'store.inspectorOpen() && store.selectedNode() !== null', '[class.has-panel]': 'store.leftPanel() !== null' },
  template: `
    <!-- The editor is a single view with no visible page title; assistive technology still needs one. -->
    <h1 class="sr-only">MAD Studio: {{ store.projectName() }}</h1>
    <mad-studio-topbar class="[grid-area:top]" />
    <mad-left-rail class="[grid-area:rail]" />
    <mad-studio-canvas class="[grid-area:canvas]" />
    @if (store.inspectorOpen() && store.selectedNode(); as node) {
      <mad-inspector-panel class="[grid-area:inspector]" [node]="node" />
    }
    <mad-prompt-bar class="[grid-area:prompt]" #promptBar />
    @if (auth.dialogOpen()) {
      <mad-auth-dialog />
    }
  `,
  styles: `
    :host {
      grid-template-areas:
        'top top top'
        'rail canvas inspector'
        'prompt prompt prompt';
      grid-template-rows: 44px minmax(0, 1fr) auto;
      grid-template-columns: max-content minmax(0, 1fr) 0px;
      transition: grid-template-columns 0.25s var(--ease-out-expo);
    }
    :host.has-inspector { grid-template-columns: max-content minmax(0, 1fr) 320px; }
    @media (max-width: 900px) {
      :host.has-inspector { grid-template-columns: max-content minmax(0, 1fr) 280px; }
    }
  `,
})
export class StudioPage {
  protected readonly store = inject(StudioStore);
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly promptBar = viewChild<PromptBar>('promptBar');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Bound from the route via withComponentInputBinding. */
  readonly projectId = input<string | undefined>();
  private readonly promptParam = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('prompt'))), { initialValue: null });
  private handledPrompt: string | null = null;
  private loadedProject: string | null = null;

  constructor() {
    effect(() => {
      const prompt = this.promptParam();
      const id = this.projectId();
      if (prompt && prompt !== this.handledPrompt) {
        this.handledPrompt = prompt;
        void this.store.generate(prompt);
        return;
      }
      if (id && id !== this.loadedProject && !this.store.generating()) {
        this.loadedProject = id;
        if (this.store.projectId() !== id) void this.store.loadProject(id);
      }
    });
  }

  @HostListener('window:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (this.auth.dialogOpen()) return;
    const target = event.target as HTMLElement | null;
    const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.store.save();
      return;
    }
    if (mod && event.key.toLowerCase() === 'z') {
      if (inField) return;
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'y') {
      if (inField) return;
      event.preventDefault();
      this.store.redo();
      return;
    }
    if (inField) {
      if (event.key === 'Escape') (target as HTMLElement).blur();
      return;
    }
    const selected = this.store.selectedId();
    switch (event.key) {
      case '/':
        event.preventDefault();
        this.promptBar()?.focus();
        break;
      case 'Escape':
        this.store.select(null);
        break;
      case 'Delete':
      case 'Backspace':
        if (selected) {
          event.preventDefault();
          this.store.remove(selected);
        }
        break;
      case 'd':
      case 'D':
        if (mod && selected) {
          event.preventDefault();
          this.store.duplicate(selected);
        }
        break;
      case 'ArrowUp':
        if (selected) {
          event.preventDefault();
          if (event.altKey) this.store.moveWithinParent(selected, -1);
          else this.store.selectSibling(-1);
        }
        break;
      case 'ArrowDown':
        if (selected) {
          event.preventDefault();
          if (event.altKey) this.store.moveWithinParent(selected, 1);
          else this.store.selectSibling(1);
        }
        break;
      case 'ArrowLeft':
        if (selected) {
          event.preventDefault();
          this.store.selectParent();
        }
        break;
      case 'ArrowRight':
        if (selected) {
          event.preventDefault();
          this.store.selectFirstChild();
        }
        break;
      case '1':
      case '2':
      case '3':
      case '4': {
        if (mod) return;
        const devices = ['desktop', 'tablet', 'iphone', 'android'] as const;
        const d = devices[Number(event.key) - 1];
        if (d) this.store.device.set(d);
        break;
      }
      case '`':
        this.store.consoleOpen.update((v) => !v);
        break;
      default:
        break;
    }
  }
}
