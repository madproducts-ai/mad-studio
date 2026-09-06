import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DEVICE_VIEWPORTS, type DesignSystem, type Device, type MadNode } from '@mad/schema';
import { NodeView } from './node-view.component';

/**
 * Device chrome around a rendered document. Sets the renderer token set for the
 * chosen design system and theme, and sizes the viewport to the real device.
 * `scale` shrinks the whole frame visually while the document lays out at the
 * device's true CSS pixel width, so responsive behaviour is authentic.
 */
@Component({
  selector: 'mad-device-frame',
  imports: [NodeView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '[style.width.px]': 'outerWidth()', '[style.height.px]': 'outerHeight()' },
  template: `
    <div
      class="frame"
      [attr.data-device]="device()"
      [attr.data-ds]="designSystem()"
      [attr.data-rtheme]="theme()"
      [style.width.px]="vp().width"
      [style.height.px]="vp().height"
      [style.transform]="'scale(' + scale() + ')'"
      [style.border-radius.px]="vp().radius"
    >
      @if (device() === 'iphone') {
        <span class="island" aria-hidden="true"></span>
      }
      @if (device() === 'android') {
        <span class="punch" aria-hidden="true"></span>
      }
      @if (device() === 'desktop') {
        <div class="browser-bar" aria-hidden="true">
          <span class="dots"><i></i><i></i><i></i></span>
          <span class="url">{{ urlLabel() }}</span>
        </div>
      }
      <div class="viewport" [class.has-bar]="device() === 'desktop'">
        @if (root(); as r) {
          <mad-node [node]="r" [depth]="0" />
        } @else {
          <div class="empty">
            <ng-content />
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host { position: relative; }
    .frame {
      position: relative;
      transform-origin: top left;
      overflow: hidden;
      background: var(--r-bg);
      color: var(--r-ink);
      box-shadow: 0 0 0 1px var(--mad-line-strong), 0 40px 120px -40px rgb(0 0 0 / 0.7);
      font-family: var(--r-font);
      /* renderer tokens: dark */
      --r-font: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
      --r-font-display: 'Bricolage Grotesque', 'Instrument Sans', ui-sans-serif, sans-serif;
      --r-mono: 'JetBrains Mono', ui-monospace, monospace;
      --r-bg: #0d1016;
      --r-surface: #13171f;
      --r-raised: #1a1f2a;
      --r-input-bg: #0f1218;
      --r-line: #262c3a;
      --r-line-strong: #364052;
      --r-ink: #e8ebf1;
      --r-ink-2: #c0c7d6;
      --r-ink-3: #8e97ab;
      --r-accent: #f5a524;
      --r-accent-ink: #1a1203;
      --r-live: #5fd3ff;
      --r-success: #3ddc97;
      --r-danger: #ff6b6b;
      --r-bar: #3a4257;
      --r-avatar-bg: #2b3345;
      --r-avatar-ink: #e8ebf1;
      --r-radius-sm: 6px;
      --r-radius-md: 8px;
      --r-radius-lg: 12px;
      --r-shadow-sm: 0 1px 2px rgb(0 0 0 / 0.25);
      --r-shadow-md: 0 6px 20px -8px rgb(0 0 0 / 0.5);
      --r-shadow-lg: 0 20px 50px -20px rgb(0 0 0 / 0.65);
    }
    .frame[data-rtheme='light'] {
      --r-bg: #f4f6f9;
      --r-surface: #ffffff;
      --r-raised: #eef1f6;
      --r-input-bg: #ffffff;
      --r-line: #dde2ea;
      --r-line-strong: #c2cad8;
      --r-ink: #0d1016;
      --r-ink-2: #2b3445;
      --r-ink-3: #5b6577;
      --r-accent: #b76b00;
      --r-accent-ink: #ffffff;
      --r-live: #0369a1;
      --r-success: #0f7a4c;
      --r-danger: #b3261e;
      --r-bar: #c2cad8;
      --r-avatar-bg: #e3e8f0;
      --r-avatar-ink: #0d1016;
      --r-shadow-sm: 0 1px 2px rgb(13 16 22 / 0.06);
    }
    .frame[data-ds='material'] {
      --r-font: 'Roboto', 'Instrument Sans', system-ui, sans-serif;
      --r-font-display: 'Roboto', 'Instrument Sans', system-ui, sans-serif;
      --r-accent: #d0bcff;
      --r-accent-ink: #381e72;
      --r-live: #4fc3f7;
      --r-bg: #141218;
      --r-surface: #1d1b20;
      --r-raised: #2b2930;
      --r-input-bg: #211f26;
      --r-line: #36343b;
      --r-line-strong: #49454f;
      --r-radius-lg: 16px;
      --r-radius-md: 12px;
    }
    .frame[data-ds='material'][data-rtheme='light'] {
      --r-accent: #6750a4;
      --r-accent-ink: #ffffff;
      --r-live: #006494;
      --r-bg: #fef7ff;
      --r-surface: #ffffff;
      --r-raised: #f3edf7;
      --r-input-bg: #e6e0e9;
      --r-line: #e7e0ec;
      --r-line-strong: #cac4d0;
    }
    .frame[data-ds='wordpress'] {
      --r-font: 'Instrument Sans', -apple-system, 'Segoe UI', system-ui, sans-serif;
      --r-font-display: 'Instrument Sans', -apple-system, system-ui, sans-serif;
      --r-accent: #3858e9;
      --r-accent-ink: #ffffff;
      --r-live: #72aee6;
      --r-bg: #1d2327;
      --r-surface: #23282d;
      --r-raised: #2c3338;
      --r-input-bg: #1d2327;
      --r-line: #3c434a;
      --r-line-strong: #50575e;
      --r-radius-lg: 4px;
      --r-radius-md: 3px;
      --r-radius-sm: 2px;
    }
    .frame[data-ds='wordpress'][data-rtheme='light'] {
      --r-bg: #f0f0f1;
      --r-surface: #ffffff;
      --r-raised: #f6f7f7;
      --r-input-bg: #ffffff;
      --r-line: #dcdcde;
      --r-line-strong: #c3c4c7;
      --r-sidebar-bg: #1d2327;
      --r-accent: #2271b1;
      --r-live: #135e96;
    }
    .frame[data-device='iphone'] { --r-base: 15px; --r-sidebar-w: 0px; }
    .frame[data-device='android'] { --r-base: 15px; --r-sidebar-w: 0px; }
    .frame[data-device='tablet'] { --r-base: 14px; --r-sidebar-w: 200px; }
    /* status-bar safe areas: content starts below the island / punch hole */
    .frame[data-device='iphone'] .viewport { top: 54px; }
    .frame[data-device='android'] .viewport { top: 36px; }
    .frame[data-device='iphone']::before, .frame[data-device='android']::before { content: ''; position: absolute; inset: 0 0 auto; height: 54px; background: var(--r-surface); z-index: 4; }
    .frame[data-device='android']::before { height: 36px; }
    .island { position: absolute; top: 11px; left: 50%; width: 120px; height: 34px; transform: translateX(-50%); background: #000; border-radius: 20px; z-index: 5; }
    .punch { position: absolute; top: 12px; left: 50%; width: 14px; height: 14px; transform: translateX(-50%); background: #000; border-radius: 50%; z-index: 5; }
    .browser-bar { display: flex; align-items: center; gap: 14px; height: 40px; padding: 0 14px; background: color-mix(in oklab, var(--r-surface) 85%, black); border-bottom: 1px solid var(--r-line); }
    .dots { display: inline-flex; gap: 6px; }
    .dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--r-line-strong); }
    .url { flex: 1; max-width: 420px; margin: 0 auto; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: var(--r-bg); color: var(--r-ink-3); font-family: var(--r-mono); font-size: 11px; letter-spacing: 0.02em; }
    .viewport { position: absolute; inset: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    .viewport.has-bar { top: 40px; }
    .empty { display: flex; height: 100%; align-items: center; justify-content: center; padding: 32px; }
  `,
})
export class DeviceFrame {
  readonly root = input<MadNode | null>(null);
  readonly device = input<Device>('desktop');
  readonly designSystem = input<DesignSystem>('tailwind');
  readonly theme = input<'dark' | 'light'>('dark');
  readonly scale = input<number>(1);
  readonly urlLabel = input<string>('preview.madproducts.app');

  protected readonly vp = computed(() => DEVICE_VIEWPORTS[this.device()]);
  protected readonly outerWidth = computed(() => Math.round(this.vp().width * this.scale()));
  protected readonly outerHeight = computed(() => Math.round(this.vp().height * this.scale()));
}
