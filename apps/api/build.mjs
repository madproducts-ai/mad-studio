import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Bundles the API into a single CommonJS file. Workspace packages (@mad/*) are
 * aliased to their TypeScript sources and bundled; every other bare import stays
 * external and is resolved from node_modules at runtime.
 */
await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(here, 'dist/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  packages: 'external',
  alias: {
    '@mad/schema': resolve(here, '../../packages/schema/src/index.ts'),
    '@mad/planner': resolve(here, '../../packages/planner/src/index.ts'),
  },
  tsconfig: resolve(here, 'tsconfig.json'),
  logLevel: 'info',
});
