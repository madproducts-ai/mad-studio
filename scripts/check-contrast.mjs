#!/usr/bin/env node
/**
 * Contrast gate for generated applications.
 *
 * Renders one planned document through the static exporter in every design
 * system and theme, opens each page in Chromium, and measures every piece of
 * text against the background it actually sits on. Fails when anything falls
 * below WCAG AA (4.5:1, or 3:1 for large text).
 *
 * The exporter's stylesheet is generated from the studio's canvas CSS, so this
 * covers both surfaces: a token that is unreadable here is unreadable in the
 * editor too. Run with `npm run check:contrast`.
 */
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { plan } from '@mad/planner';
import { renderDocumentHtml } from '@mad/export';

const PROMPT = process.env['CONTRAST_PROMPT'] ?? 'Build an internal CRM dashboard with Stripe billing, a customer support chat, a marketing landing page and a settings screen';
const DESIGN_SYSTEMS = ['tailwind', 'material', 'wordpress'];
const THEMES = ['dark', 'light'];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

/** Runs in the page: measures text against its effective background. */
const AUDIT = (options = {}) => {
  const exclude = options.exclude ?? null;
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a] = m[1].split(',').map((x) => Number.parseFloat(x));
    return { r, g, b, a: a === undefined ? 1 : a };
  };
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const bgOf = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        acc = acc ? over(acc, c) : c;
        if (acc.a >= 1 || c.a >= 1) return acc;
      }
      node = node.parentElement;
    }
    const html = parse(getComputedStyle(document.documentElement).backgroundColor);
    return acc ?? (html && html.a > 0 ? html : { r: 255, g: 255, b: 255, a: 1 });
  };

  const findings = [];
  let lowest = Infinity;
  const hasGradient = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      if (getComputedStyle(n).backgroundImage !== 'none') return true;
      n = n.parentElement;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    if (exclude && el.closest(exclude)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    // A gradient or image behind the text cannot be sampled from one colour.
    if (hasGradient(el)) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number.parseFloat(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const r = ratio(over(fg, bg), bg);
    const size = Number.parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number.parseInt(cs.fontWeight, 10) >= 700);
    const need = large ? 3 : 4.5;
    if (r < lowest) lowest = r;
    if (r < need) findings.push({ text: text.slice(0, 40), selector: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`, ratio: Math.round(r * 100) / 100, need });
  }
  return { findings, lowest: Number.isFinite(lowest) ? Math.round(lowest * 100) / 100 : null };
};

const WEB_DIST = resolve('apps/web/dist/web/browser');
const STUDIO_ROUTES = ['/', '/studio'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

/** Serves the built app with SPA fallback so client routes resolve. */
const serveDist = () =>
  new Promise((ready) => {
    const server = createServer((req, res) => {
      const url = (req.url ?? '/').split('?')[0];
      const candidate = resolve(WEB_DIST, '.' + normalize(url));
      const inside = candidate === WEB_DIST || candidate.startsWith(WEB_DIST + sep);
      const file = inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(WEB_DIST, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => ready({ server, port: server.address().port }));
  });

const dir = mkdtempSync(join(tmpdir(), 'mad-contrast-'));
let failures = 0;
let checked = 0;

try {
  const browser = await chromium.launch();
  for (const designSystem of DESIGN_SYSTEMS) {
    const { document } = plan(PROMPT, { designSystem, pace: 0 });
    for (const theme of THEMES) {
      const file = join(dir, `${designSystem}-${theme}.html`);
      writeFileSync(
        file,
        renderDocumentHtml(
          { ...document, theme },
          { title: `${designSystem} / ${theme}`, target: 'preview', version: 1, deployedAt: new Date(0).toISOString(), deploymentId: `${designSystem}-${theme}`, fonts: false },
        ),
      );
      for (const viewport of VIEWPORTS) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
        await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
        const { findings, lowest } = await page.evaluate(AUDIT);
        await page.close();
        checked += 1;
        const label = `${designSystem}/${theme}/${viewport.name}`;
        if (findings.length === 0) {
          console.log(`  ok   ${label.padEnd(28)} lowest ${lowest}:1`);
        } else {
          failures += findings.length;
          console.log(`  FAIL ${label.padEnd(28)} ${findings.length} below AA`);
          const seen = new Set();
          for (const f of findings.sort((a, b) => a.ratio - b.ratio)) {
            if (seen.has(f.selector)) continue;
            seen.add(f.selector);
            console.log(`       ${f.ratio}:1 (needs ${f.need}) ${f.selector} — "${f.text}"`);
          }
        }
      }
    }
  }
  // ---- the studio's own interface, in both themes ----
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    console.log("\n  skipped studio chrome: apps/web/dist not built (run npm run build:web first)");
  } else {
    const { server, port } = await serveDist();
    try {
      for (const route of STUDIO_ROUTES) {
        for (const theme of THEMES) {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
          await page.addInitScript((t) => {
            try {
              localStorage.setItem('mad:theme', t);
            } catch {
              /* storage can be unavailable; the attribute below still applies */
            }
          }, theme);
          await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'load' });
          await page.waitForTimeout(1200);
          // The generated document inside the canvas has its own pass above.
          const { findings, lowest } = await page.evaluate(AUDIT, { exclude: '.frame' });
          await page.close();
          checked += 1;
          const label = `studio${route === '/' ? '/landing' : route}/${theme}`;
          if (findings.length === 0) {
            console.log(`  ok   ${label.padEnd(28)} lowest ${lowest}:1`);
          } else {
            failures += findings.length;
            console.log(`  FAIL ${label.padEnd(28)} ${findings.length} below AA`);
            const seen = new Set();
            for (const f of findings.sort((a, b) => a.ratio - b.ratio)) {
              if (seen.has(f.selector)) continue;
              seen.add(f.selector);
              console.log(`       ${f.ratio}:1 (needs ${f.need}) ${f.selector} â€” "${f.text}"`);
            }
          }
        }
      }
    } finally {
      server.close();
    }
  }

  await browser.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? `\ncontrast: ${checked} renderings clear WCAG AA` : `\ncontrast: ${failures} element(s) below WCAG AA`);
process.exit(failures === 0 ? 0 : 1);
