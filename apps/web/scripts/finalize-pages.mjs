/**
 * Post-build step for GitHub Pages.
 *  - 404.html mirrors index.html so deep links (/studio/<id>) load the SPA.
 *  - .nojekyll stops Pages from ignoring underscore-prefixed files.
 * Usage: node scripts/finalize-pages.mjs [dist dir]  (default apps/web/dist/web/browser)
 */
import { copyFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.argv[2] ?? resolve(here, '../dist/web/browser'));

await access(resolve(dist, 'index.html'));
await copyFile(resolve(dist, 'index.html'), resolve(dist, '404.html'));
await writeFile(resolve(dist, '.nojekyll'), '');
console.log(`Pages artifact ready in ${dist} (404.html + .nojekyll)`);
