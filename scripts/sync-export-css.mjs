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

/* ---------- live controls ----------
   The canvas draws controls as inert spans, because a live button there would
   swallow the click that selects a node. A deployed page emits real buttons,
   inputs, selects and checkboxes, so it carries the reset and the focus, hover
   and state styling those elements need. None of this exists on the canvas. */
.r-btn, .r-icon-btn, .r-nav-link, .r-sidebar-item, .r-tab, .r-th-sort, .r-legend-item, .r-switch, .r-kanban-card {
  appearance: none; -webkit-appearance: none; background: none; border: 0; margin: 0; font: inherit; color: inherit; text-align: inherit; cursor: pointer;
}
.r-input, .r-select, .r-check { appearance: none; -webkit-appearance: none; font: inherit; }
.r-btn:disabled, .r-btn.is-disabled { cursor: not-allowed; }
:where(.r-btn, .r-icon-btn, .r-nav-link, .r-sidebar-item, .r-tab, .r-th-sort, .r-legend-item, .r-switch, .r-kanban-card, .r-input, .r-select, .r-check, .r-tabpanel):focus-visible {
  outline: 2px solid var(--r-accent); outline-offset: 2px;
}
.r-tabpanel:focus { outline: none; }

/* Fields: the label is a sibling of the control now, not a wrapper. */
.r-field { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.r-input-wrap { position: relative; display: flex; align-items: center; width: 100%; }
.r-input-wrap > .r-icon { position: absolute; left: 0.6rem; color: var(--r-ink-3); pointer-events: none; }
.r-input-wrap[data-type='search'] > .r-input { padding-left: 2rem; }
.r-input-wrap[data-type='select'] > .r-icon { left: auto; right: 0.6rem; }
.r-input-wrap > .r-select { padding-right: 2rem; width: 100%; }
.r-input::placeholder { color: var(--r-ink-3); opacity: 1; }
textarea.r-input { resize: vertical; min-height: 4.5rem; line-height: 1.5; }
.r-input[aria-invalid='true'] { border-color: var(--r-danger); }
.r-error { display: block; font-size: 0.72em; color: var(--r-danger); }
.r-error[hidden] { display: none; }
.r-form-status { margin: 0; font-size: 0.78em; color: var(--r-ink-3); min-height: 1.2em; }
.r-form-status[data-tone='success'] { color: var(--r-success); }
.r-form-status[data-tone='danger'] { color: var(--r-danger); }

/* Checkboxes: a real input, drawn like the span it replaced. */
.r-check { display: inline-block; width: 14px; height: 14px; flex: none; border: 1px solid var(--r-line-strong); border-radius: 4px; background: var(--r-surface); cursor: pointer; position: relative; }
.r-check:checked { background: var(--r-accent); border-color: var(--r-accent); }
.r-check:checked::after { content: ''; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px; border: solid var(--r-accent-ink); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.r-check:indeterminate { background: var(--r-accent); border-color: var(--r-accent); }
.r-check:indeterminate::after { content: ''; position: absolute; left: 2px; top: 5px; width: 8px; height: 2px; background: var(--r-accent-ink); }
.r-table tbody tr.is-selected { background: color-mix(in oklab, var(--r-accent) 10%, transparent); }

/* Sortable headers */
.r-th-sort { display: inline-flex; align-items: center; gap: 0.25rem; width: 100%; }
.r-th-sort .r-icon { opacity: 0; transition: opacity 0.12s ease, transform 0.12s ease; }
.r-th-sort:hover .r-icon, th[aria-sort='ascending'] .r-icon, th[aria-sort='descending'] .r-icon { opacity: 0.7; }
th[aria-sort='ascending'] .r-icon { transform: rotate(180deg); }
.r-table-head-bare { justify-content: flex-end; }
.r-empty-state { margin: 0; padding: 1.25rem; text-align: center; font-size: 0.8em; color: var(--r-ink-3); }
.r-empty-state[hidden] { display: none; }

/* Nav search and notifications */
.r-search-wrap, .r-popover-wrap { position: relative; display: inline-flex; align-items: center; }
.r-nav-search { height: 30px; width: 13rem; max-width: 40vw; padding: 0 0.6rem; border: 1px solid var(--r-line-strong); border-radius: 8px; background: var(--r-surface); color: var(--r-ink); font: inherit; font-size: 0.8em; margin-left: 0.4rem; }
.r-nav-search[hidden] { display: none; }
.r-popover { position: absolute; top: calc(100% + 8px); right: 0; z-index: 40; display: grid; gap: 0.5rem; width: 17rem; padding: 0.75rem; border: 1px solid var(--r-line-strong); border-radius: 12px; background: var(--r-raised); box-shadow: 0 18px 40px -20px rgb(0 0 0 / 0.55); }
.r-popover[hidden] { display: none; }
.r-popover-title { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--r-ink-3); }
.r-popover-item { display: flex; align-items: baseline; gap: 0.5rem; font-size: 0.78em; color: var(--r-ink-2); }
.r-popover-tag { flex: none; font-size: 0.85em; color: var(--r-ink-3); }

/* Kanban cards are buttons in lists now */
.r-kanban-cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
.r-kanban-cards > li[hidden] { display: none; }
.r-kanban-card { width: 100%; display: grid; gap: 0.4rem; }
.r-kanban-card.is-dragging { opacity: 0.45; }
.r-kanban-col.is-drop-target { outline: 2px dashed var(--r-accent); outline-offset: 3px; border-radius: 12px; }

/* Chart legend entries toggle their series */
.r-legend-item { display: inline-flex; align-items: center; gap: 0.375rem; }
.r-legend-item.is-off { opacity: 0.4; }

/* Chosen plan */
.r-price-card.is-chosen { outline: 2px solid var(--r-accent); outline-offset: 2px; }

/* Toasts */
.r-toasts { position: fixed; left: 50%; bottom: 20px; z-index: 60; display: grid; gap: 0.5rem; justify-items: center; transform: translateX(-50%); pointer-events: none; }
.r-toast { padding: 0.5rem 0.9rem; border-radius: 999px; border: 1px solid var(--r-line-strong); background: var(--r-raised); color: var(--r-ink); font-size: 0.8em; box-shadow: 0 12px 32px -16px rgb(0 0 0 / 0.6); animation: r-toast-in 0.24s var(--ease-out-expo) both; }
.r-toast.is-leaving { animation: r-toast-out 0.24s ease forwards; }
@keyframes r-toast-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes r-toast-out { to { opacity: 0; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) { .r-toast, .r-toast.is-leaving { animation: none; } }
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
