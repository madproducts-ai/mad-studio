#!/usr/bin/env node
/**
 * Derives the static-export stylesheet from the studio's canvas renderer so the
 * two can never drift: the Angular component CSS (with :host / :host-context /
 * <mad-node> selectors) is rewritten into plain selectors, and the renderer
 * token set is lifted out of the device-frame component. Run via
 * `npm run sync:export-css`; the export package's tests fail when the checked-in
 * output is stale.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NODE_CSS = 'apps/web/src/app/core/render/node-view.component.css';
const FRAME_TS = 'apps/web/src/app/core/render/device-frame.component.ts';
const OUTPUT = 'packages/export/src/renderer.css.ts';

/** Rewrites Angular emulated-encapsulation selectors into plain CSS for a `.r-node` DOM. */
export const transformNodeCss = (css) =>
  css
    // :host-context(X):host(Y) → X .r-node Y
    .replace(/:host-context\(([^)]*)\):host\(([^)]*)\)/g, '$1 .r-node$2')
    // :host-context(X) { → X .r-node {
    .replace(/:host-context\(([^)]*)\)\s*\{/g, '$1 .r-node {')
    // :host-context(X) descendant → X descendant
    .replace(/:host-context\(([^)]*)\)/g, '$1')
    // :host(X) → .r-nodeX
    .replace(/:host\(([^)]*)\)/g, '.r-node$1')
    // bare :host → .r-node
    .replace(/:host(?![-\w(])/g, '.r-node')
    .replace(/\bmad-node\b/g, '.r-node')
    .replace(/\bmad-icon\b/g, '.r-icon');

/** Pulls the `.frame…` token rules out of the device-frame component styles. */
export const extractFrameTokens = (componentSource) => {
  const match = componentSource.match(/styles:\s*`([\s\S]*?)`,\s*\n\s*\}\)/);
  if (!match) throw new Error('device-frame.component.ts: could not locate the styles template literal');
  const styles = match[1];
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(styles)) !== null) {
    const selector = m[1].trim();
    if (!selector.startsWith('.frame')) continue;
    if (/\.viewport|::before|\.island|\.punch|\.browser-bar/.test(selector)) continue;
    // Strip comments first: a comment glued to the next declaration would otherwise take it down with it.
    const declarations = m[2]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      // Layout belongs to the studio's device chrome, not to a deployed page.
      .filter((d) => !/^(position|transform-origin|overflow|box-shadow|font-family):/.test(d) || d.startsWith('--'))
      .filter((d) => !d.startsWith('/*'));
    rules.push(`${selector.replace(/\.frame/g, '.r-frame')} {\n  ${declarations.join(';\n  ')};\n}`);
  }
  if (rules.length === 0) throw new Error('device-frame.component.ts: no .frame token rules found');
  return rules.join('\n');
};

/** Page-level rules the canvas gets from the studio shell and the export must carry itself. */
export const BASE_CSS = `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--r-bg); color: var(--r-ink); font-family: var(--r-font); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
.r-frame { min-height: 100vh; display: flex; flex-direction: column; font-family: var(--r-font); --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1); --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); }
.r-frame > .r-node[data-node-type='page'] { flex: 1; }
.r-icon { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; line-height: 1; }
.r-chart-svg { display: block; width: 100%; }
.r-chart-svg > svg { display: block; height: 8rem; width: 100%; overflow: visible; }
.r-chart-legend { margin-top: 0.5rem; display: flex; flex-wrap: wrap; align-items: center; column-gap: 1rem; row-gap: 0.25rem; font-size: 0.72em; color: var(--r-ink-3); }
.r-chart-legend span { display: inline-flex; align-items: center; gap: 0.375rem; }
.r-chart-legend i { display: inline-block; height: 2px; width: 0.75rem; border-radius: 999px; }
.r-donut { display: flex; align-items: center; gap: 1.25rem; }
.r-donut > svg { width: 7rem; height: 7rem; flex-shrink: 0; transform: rotate(-90deg); }
.r-donut-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.5rem; font-size: 0.78em; }
.r-donut-list li { display: flex; align-items: center; gap: 0.5rem; }
.r-donut-list i { display: inline-block; width: 0.5rem; height: 0.5rem; border-radius: 999px; }
.r-donut-list b { margin-left: auto; padding-left: 1rem; font-family: var(--r-mono); font-weight: 500; color: var(--r-ink); }
.r-donut-list span { color: var(--r-ink-2); }
.line { stroke-dasharray: 1000; stroke-dashoffset: 1000; animation: draw 1.4s var(--ease-out-expo) forwards; }
@keyframes draw { to { stroke-dashoffset: 0; } }
.bar { transform-origin: bottom; transform-box: fill-box; animation: grow 0.7s var(--ease-out-expo) both; animation-delay: calc(var(--i) * 40ms); }
@keyframes grow { from { transform: scaleY(0); } }
@media (prefers-reduced-motion: reduce) { .line, .bar { animation: none; stroke-dashoffset: 0; } }
.mad-badge { position: fixed; right: 14px; bottom: 14px; z-index: 50; display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 11px 0 8px; border-radius: 999px; background: #0d1016; color: #e8ebf1; border: 1px solid #364052; font: 600 11.5px/1 'Instrument Sans', system-ui, sans-serif; letter-spacing: 0.01em; text-decoration: none; box-shadow: 0 8px 24px -12px rgb(0 0 0 / 0.6); opacity: 0.92; }
.mad-badge:hover { opacity: 1; }
.mad-badge i { width: 14px; height: 14px; border-radius: 4px; background: #f5a524; position: relative; }
.mad-badge i::after { content: ''; position: absolute; right: 2px; bottom: 2px; width: 3px; height: 3px; background: #5fd3ff; }
`;

export const buildRendererCss = (root = repoRoot) => {
  const nodeCss = readFileSync(resolve(root, NODE_CSS), 'utf8');
  const frameTs = readFileSync(resolve(root, FRAME_TS), 'utf8');
  return [
    '/* Generated by scripts/sync-export-css.mjs from the studio renderer. Do not edit by hand. */',
    BASE_CSS.trim(),
    '',
    '/* ---------- renderer tokens (device-frame.component.ts) ---------- */',
    extractFrameTokens(frameTs),
    '',
    '/* ---------- node renderer (node-view.component.css) ---------- */',
    transformNodeCss(nodeCss).trim(),
    '',
  ].join('\n');
};

export const renderModule = (css) =>
  `// Generated by scripts/sync-export-css.mjs — run \`npm run sync:export-css\` after editing the studio renderer CSS.\nexport const RENDERER_CSS: string = ${JSON.stringify(css)};\n`;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const css = buildRendererCss();
  writeFileSync(resolve(repoRoot, OUTPUT), renderModule(css));
  console.log(`wrote ${OUTPUT} (${css.length} chars)`);
}
