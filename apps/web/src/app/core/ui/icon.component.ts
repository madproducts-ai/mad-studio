import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Inline 24×24 stroke icon set. Paths are authored once here so the app ships
 * no icon font and every glyph inherits `currentColor`.
 */
export const ICONS = {
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-up-right': 'M7 17 17 7M8 7h9v9',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-up': 'm18 15-6-6-6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm5 12 4.5 4.5L19 7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.6-3.6',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6L5 2z',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5',
  'layout-grid': 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  component: 'M12 3 8 7l4 4 4-4-4-4zM5 10l-4 4 4 4 4-4-4-4zM19 10l-4 4 4 4 4-4-4-4zM12 17l-4 4 4 4 4-4-4-4z',
  plug: 'M9 2v6M15 2v6M6 8h12l-1 5a5 5 0 0 1-10 0L6 8zM12 18v4',
  database: 'M12 3c5 0 8 1.3 8 3s-3 3-8 3-8-1.3-8-3 3-3 8-3zM4 6v12c0 1.7 3 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3 3 8 3s8-1.3 8-3',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  'monitor': 'M3 5h18v11H3zM8 21h8M12 16v5',
  tablet: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 18h.01',
  smartphone: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 18h.01',
  'phone-android': 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 19h4',
  play: 'M6 4l14 8-14 8V4z',
  square: 'M5 5h14v14H5z',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M12 15l-3-3c1-4 4-8 10-9-1 6-5 9-9 10zM15 9h.01',
  'external-link': 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M3 3l18 18M10.6 10.6A3 3 0 0 0 13.4 13.4M6.7 6.7C4 8.3 2 12 2 12s3.5 6 10 6c1.6 0 3-.3 4.3-.9M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7s-1 1.7-2.8 3.4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
  terminal: 'm4 17 6-5-6-5M12 19h8',
  'message-square': 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  'credit-card': 'M2 6h20v12H2zM2 10h20M6 15h4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  'bar-chart': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  'trending-up': 'm3 17 6-6 4 4 8-8M14 7h7v7',
  'trending-down': 'm3 7 6 6 4-4 8 8M14 17h7v-7',
  'minus-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12h8',
  'grip-vertical': 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  'corner-down-left': 'M20 4v7a4 4 0 0 1-4 4H4M9 10l-5 5 5 5',
  command: 'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  'cloud-off': 'M3 3l18 18M8 18h11a4 4 0 0 0 1.7-7.6A7 7 0 0 0 9.7 6.3M5.5 7.3A7 7 0 0 0 6 18h2',
  cloud: 'M8 18h11a4 4 0 0 0 .8-7.9A7 7 0 1 0 6 18h2',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M2 9a15 15 0 0 1 20 0',
  'shield-check': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  'git-branch': 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  box: 'M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7.5 12 12l8.7-4.5M12 22V12',
  type: 'M4 7V4h16v3M9 20h6M12 4v16',
  'align-left': 'M4 6h16M4 12h10M4 18h14',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  'zoom-in': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.6-3.6M11 8v6M8 11h6',
  'zoom-out': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.6-3.6M8 11h6',
  'file-code': 'M14 3v5h5M9 13l-2 2 2 2M15 13l2 2-2 2M6 3h8l5 5v13H6z',
  'mouse-pointer': 'M4 4l7 17 2.5-6.5L20 12 4 4z',
  key: 'M15 2a7 7 0 0 1 0 14 7 7 0 0 1-2.5-.5L10 18H8v2H6v2H2v-4l6.5-6.5A7 7 0 0 1 15 2zM16 8h.01',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  download: 'M12 4v12M6 10l6 6 6-6M4 20h16',
  'shopping-cart': 'M3 3h2l3 12h11l2-8H6M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  mail: 'M3 5h18v14H3zM3 7l9 6 9-6',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  cpu: 'M9 9h6v6H9zM5 5h14v14H5zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  'alert-triangle': 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  'check-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8.5 12l2.5 2.5 5-5',
  'loader': 'M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8',
  panel: 'M3 4h18v16H3zM9 4v16',
  'panel-right': 'M3 4h18v16H3zM15 4v16',
  'panel-bottom': 'M3 4h18v16H3zM3 15h18',
  image: 'M3 5h18v14H3zM8 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5-9 9',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  'toggle-right': 'M7 6h10a6 6 0 0 1 0 12H7A6 6 0 0 1 7 6zM17 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  columns: 'M3 4h18v16H3zM12 4v16',
  'move-up': 'M12 20V8M6 14l6-6 6 6M5 4h14',
  'move-down': 'M12 4v12M6 10l6 6 6-6M5 20h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20A15 15 0 0 1 12 2z',
} as const;

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'mad-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0 items-center justify-center leading-none', '[style.width.px]': 'size()', '[style.height.px]': 'size()', 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor" [attr.stroke-width]="strokeWidth()" stroke-linecap="round" stroke-linejoin="round">
      <path [attr.d]="path()" />
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input<number>(16);
  readonly strokeWidth = input<number>(1.75);
  protected readonly path = computed(() => ICONS[this.name()]);
}
