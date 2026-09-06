import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { MadNode, PropControl, PropValue, StyleProps } from '@mad/schema';
import { NODE_PROP_CONTROLS, isContainer } from '@mad/schema';
import { Icon, ICONS, type IconName } from '../../core/ui/icon.component';
import { StudioStore } from '../state/studio.store';
import { TYPE_ICON } from '../layers/layer-tree.component';

type Tab = 'content' | 'layout';
type Side = 'top' | 'right' | 'bottom' | 'left';

@Component({
  selector: 'mad-inspector-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inspector flex min-h-0 flex-col border-l border-line bg-panel' },
  templateUrl: './inspector-panel.component.html',
  styleUrl: './inspector-panel.component.css',
})
export class InspectorPanel {
  readonly node = input.required<MadNode>();
  protected readonly store = inject(StudioStore);
  protected readonly tab = signal<Tab>('content');
  protected readonly Math = Math;

  protected readonly controls = computed<readonly PropControl[]>(() => NODE_PROP_CONTROLS[this.node().type]);
  protected readonly groups = computed(() => {
    const c = this.controls();
    return (['content', 'data', 'behaviour'] as const).map((g) => ({ id: g, label: g === 'content' ? 'Content' : g === 'data' ? 'Data' : 'Behaviour', controls: c.filter((x) => x.group === g) })).filter((g) => g.controls.length);
  });
  protected readonly isContainer = computed(() => isContainer(this.node().type));
  protected readonly isLayout = computed(() => this.node().type === 'stack' || this.node().type === 'grid');
  protected readonly iconOptions: readonly string[] = ['', 'plus', 'arrow', 'upload', 'download', 'external', 'key', 'trash', 'cart', 'search', 'check', 'sparkles'];
  protected readonly sides: readonly Side[] = ['top', 'right', 'bottom', 'left'];
  protected readonly swatches: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'Default', value: '' },
    { label: 'Transparent', value: 'transparent' },
    { label: 'Ember', value: '#F5A524' },
    { label: 'Signal', value: '#5FD3FF' },
    { label: 'Success', value: '#3DDC97' },
    { label: 'Danger', value: '#FF5C5C' },
    { label: 'Graphite', value: '#181C26' },
    { label: 'Ink', value: '#E7EAF0' },
  ];

  protected typeIcon(): IconName {
    return TYPE_ICON[this.node().type];
  }

  protected value(key: string): PropValue | undefined {
    return this.node().props[key];
  }
  protected text(key: string): string {
    const v = this.value(key);
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  }
  protected num(key: string, fallback = 0): number {
    const v = this.value(key);
    return typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : fallback;
  }
  protected bool(key: string): boolean {
    return this.value(key) === true;
  }
  protected list(key: string): string {
    const v = this.value(key);
    return Array.isArray(v) ? v.map(String).join('\n') : '';
  }
  protected listCount(key: string): number {
    const v = this.value(key);
    return Array.isArray(v) ? v.length : 0;
  }

  protected setProp(key: string, value: PropValue): void {
    this.store.updateProps(this.node().id, { [key]: value });
  }
  protected setNumberProp(key: string, raw: string, control: PropControl): void {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const clamped = Math.min(control.max ?? Number.POSITIVE_INFINITY, Math.max(control.min ?? Number.NEGATIVE_INFINITY, n));
    this.setProp(key, clamped);
  }
  protected setList(key: string, raw: string): void {
    this.setProp(
      key,
      raw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  protected setSelect(key: string, value: string): void {
    // Numeric-looking selects (heading level) stay strings by schema; active tab indexes are numbers.
    this.setProp(key, value);
  }

  // ---- style ----
  protected style(): StyleProps {
    return this.node().style;
  }
  protected setStyle(patch: Partial<StyleProps>): void {
    this.store.updateStyle(this.node().id, patch);
  }
  protected pad(side: Side): number {
    return this.style().padding?.[side] ?? 0;
  }
  protected setPad(side: Side, raw: string, linked: boolean): void {
    const n = Math.max(0, Math.min(160, Number(raw) || 0));
    const current = this.style().padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
    this.setStyle({ padding: linked ? { top: n, right: n, bottom: n, left: n } : { ...current, [side]: n } });
  }
  protected readonly padLinked = signal(true);
  protected setNum(key: 'gap' | 'radius' | 'columns', raw: string, min: number, max: number): void {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    this.setStyle({ [key]: Math.max(min, Math.min(max, Math.round(n))) });
  }
  protected setBackground(value: string): void {
    if (value === '') {
      const { background: _bg, ...rest } = this.style();
      this.store.updateStyle(this.node().id, { background: undefined });
      void rest;
      return;
    }
    this.setStyle({ background: value });
  }
  protected isValidHex(v: string): boolean {
    return /^#[0-9a-fA-F]{6}$/.test(v);
  }
  protected onCustomColor(raw: string): void {
    if (this.isValidHex(raw)) this.setBackground(raw.toUpperCase());
  }
  protected iconExists(name: string): boolean {
    return name in ICONS;
  }
  protected sourceLabel(): string {
    const s = this.node().source;
    return s === 'ai' ? 'Generated' : s === 'preset' ? 'Preset' : 'Hand-made';
  }
}
