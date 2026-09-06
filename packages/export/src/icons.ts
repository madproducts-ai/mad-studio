/**
 * The subset of the studio's 24×24 stroke icon set that generated documents can
 * reference. Paths are copied from apps/web/src/app/core/ui/icon.component.ts;
 * the renderer test cross-checks that they still match.
 */
export const EXPORT_ICONS = {
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'chevron-down': 'm6 9 6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm5 12 4.5 4.5L19 7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.6-3.6',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6L5 2z',
  'external-link': 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  'trending-up': 'm3 17 6-6 4 4 8-8M14 7h7v7',
  'trending-down': 'm3 7 6 6 4-4 8 8M14 17h7v-7',
  key: 'M15 2a7 7 0 0 1 0 14 7 7 0 0 1-2.5-.5L10 18H8v2H6v2H2v-4l6.5-6.5A7 7 0 0 1 15 2zM16 8h.01',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  download: 'M12 4v12M6 10l6 6 6-6M4 20h16',
  'shopping-cart': 'M3 3h2l3 12h11l2-8H6M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  image: 'M3 5h18v14H3zM8 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5-9 9',
} as const;

export type ExportIconName = keyof typeof EXPORT_ICONS;

/** Button `icon` prop → icon name, mirroring the canvas renderer. */
export const BUTTON_ICON_MAP: Record<string, ExportIconName> = {
  plus: 'plus',
  arrow: 'arrow-right',
  upload: 'upload',
  download: 'download',
  external: 'external-link',
  key: 'key',
  trash: 'trash',
  cart: 'shopping-cart',
  search: 'search',
  check: 'check',
  sparkles: 'sparkles',
};

export const iconSvg = (name: ExportIconName, size = 16): string =>
  `<svg class="r-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${EXPORT_ICONS[name]}"/></svg>`;
