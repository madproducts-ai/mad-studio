/** Tiny HTML string helpers. Every dynamic value goes through `esc`. */

export const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export type Attrs = Record<string, string | number | boolean | null | undefined>;

export const attrs = (a: Attrs): string =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join('');

export const el = (tag: string, a: Attrs = {}, children: string | string[] = ''): string => {
  const inner = Array.isArray(children) ? children.join('') : children;
  return `<${tag}${attrs(a)}>${inner}</${tag}>`;
};

export const styleAttr = (style: Record<string, string>): string =>
  Object.entries(style)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

export const classes = (...names: Array<string | false | null | undefined>): string => names.filter(Boolean).join(' ');
