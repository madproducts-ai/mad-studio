import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon, type IconName } from '../../core/ui/icon.component';
import { StudioStore, type LeftPanel } from '../state/studio.store';
import { ComponentPalette } from '../palette/component-palette.component';
import { LayerTree } from '../layers/layer-tree.component';
import { IntegrationsPanel } from '../integrations/integrations-panel.component';
import { SchemaPanel } from '../schema/schema-panel.component';
import { HistoryPanel } from '../history/history-panel.component';

@Component({
  selector: 'mad-left-rail',
  imports: [Icon, ComponentPalette, LayerTree, IntegrationsPanel, SchemaPanel, HistoryPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 overflow-hidden border-r border-line bg-panel' },
  template: `
    <nav class="flex w-12 flex-col items-center gap-1 border-r border-line py-2" aria-label="Studio panels">
      @for (item of items; track item.id) {
        <button
          type="button"
          class="rail-btn"
          [class.is-active]="store.leftPanel() === item.id"
          [attr.aria-pressed]="store.leftPanel() === item.id"
          [attr.aria-label]="item.label"
          [title]="item.label"
          (click)="toggle(item.id)"
        >
          <mad-icon [name]="item.icon" [size]="18" />
          @if (item.id === 'schema' && store.tables().length) {
            <span class="badge">{{ store.tables().length }}</span>
          }
          @if (item.id === 'integrations' && store.integrations().length) {
            <span class="badge">{{ store.integrations().length }}</span>
          }
        </button>
      }
      <span class="mt-auto"></span>
      <button type="button" class="rail-btn" [class.is-active]="store.consoleOpen()" aria-label="Toggle console (\`)" title="Console (\`)" (click)="store.consoleOpen.update(v => !v)">
        <mad-icon name="terminal" [size]="18" />
      </button>
    </nav>

    @if (store.leftPanel(); as panel) {
      <section class="panel-body flex w-[272px] min-h-0 flex-col overflow-hidden" [attr.aria-label]="panel + ' panel'">
        @switch (panel) {
          @case ('components') { <mad-component-palette /> }
          @case ('layers') { <mad-layer-tree /> }
          @case ('integrations') { <mad-integrations-panel /> }
          @case ('schema') { <mad-schema-panel /> }
          @case ('history') { <mad-history-panel /> }
        }
      </section>
    }
  `,
  styles: `
    .rail-btn { position: relative; display: flex; width: 36px; height: 36px; align-items: center; justify-content: center; border-radius: 9px; color: var(--mad-ink-3); transition: background-color 0.15s ease, color 0.15s ease, transform 0.4s var(--ease-spring); }
    .rail-btn:hover { background: var(--mad-hover); color: var(--mad-ink); }
    .rail-btn:active { transform: scale(0.94); }
    .rail-btn.is-active { background: var(--mad-raised); color: var(--mad-ember); box-shadow: inset 0 0 0 1px var(--mad-line-strong); }
    .badge { position: absolute; top: 3px; right: 3px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; background: var(--mad-signal); color: var(--mad-signal-ink); font-family: var(--font-mono); font-size: 0.58rem; line-height: 14px; text-align: center; font-weight: 600; }
    .panel-body { animation: panel-in 0.3s var(--ease-out-expo) both; }
    @keyframes panel-in { from { opacity: 0; transform: translateX(-6px); } }
  `,
})
export class LeftRail {
  protected readonly store = inject(StudioStore);
  protected readonly items: ReadonlyArray<{ id: LeftPanel; label: string; icon: IconName }> = [
    { id: 'components', label: 'Components', icon: 'component' },
    { id: 'layers', label: 'Layers', icon: 'layers' },
    { id: 'integrations', label: 'Integrations', icon: 'plug' },
    { id: 'schema', label: 'Schema', icon: 'database' },
    { id: 'history', label: 'History', icon: 'history' },
  ];

  protected toggle(id: LeftPanel): void {
    this.store.leftPanel.update((current) => (current === id ? null : id));
  }
}
