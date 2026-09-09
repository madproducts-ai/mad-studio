/**
 * Renders sample generated apps through the static exporter and writes them to a
 * directory, so a change to the renderer can be opened in a browser without
 * running the API, the database or a deploy.
 *
 *   node scripts/render-samples.mjs [outDir]
 *
 * The prompts cover the node types a generated app actually uses: navigation and
 * a sidebar, tables, forms, tabs, a kanban board, charts and a chat panel.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { plan } from '@mad/planner';
import { renderDocumentHtml } from '@mad/export';

const PROMPTS = {
  crm: 'Build an internal CRM dashboard with Stripe billing, a deal pipeline, an invoices table and a customer support chat',
  shop: 'Build a storefront admin with a product catalogue, an orders table, pricing plans and a settings form',
  ops: 'Build an operations console with a kanban board, an incidents table, a metrics chart and a team inbox',
};

const outDir = resolve(process.argv[2] ?? 'dist-samples');
mkdirSync(outDir, { recursive: true });

const rows = [];
for (const [name, prompt] of Object.entries(PROMPTS)) {
  const { document } = plan(prompt, { designSystem: 'tailwind', pace: 0 });
  for (const theme of ['dark', 'light']) {
    const html = renderDocumentHtml(
      { ...document, theme },
      {
        title: document.root.name,
        target: 'preview',
        version: 1,
        deployedAt: '2026-01-01T00:00:00.000Z',
        deploymentId: `sample-${name}-${theme}`,
      },
    );
    const file = join(outDir, `${name}-${theme}.html`);
    writeFileSync(file, html, 'utf8');
    rows.push(`${(html.length / 1024).toFixed(1).padStart(7)} kb  ${file}`);
  }
}
console.log(rows.join('\n'));
console.log(`\n${rows.length} pages in ${outDir}`);
