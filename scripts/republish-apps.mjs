/**
 * Re-renders every already-published app with the current exporter.
 *
 *   node scripts/republish-apps.mjs <exportRoot> [--dry-run] [--studio-url <url>]
 *
 * A deployment directory keeps the document it was built from, so a change to
 * the renderer can reach pages that are already live instead of waiting for
 * someone to press Deploy again. Without this, a fix to generated apps only
 * applies to apps generated after the fix.
 *
 * Everything that identifies a deployment is preserved: its id, target, version
 * and original deployment time all come back out of its own manifest, so the
 * page keeps its identity and only its rendering changes.
 */
import { readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MadDocumentSchema } from '@mad/schema';
import { buildManifest, renderDocumentHtml } from '@mad/export';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const studioUrlAt = args.indexOf('--studio-url');
const studioUrl = studioUrlAt >= 0 ? args[studioUrlAt + 1] : undefined;
const root = resolve(args.find((a) => !a.startsWith('--') && a !== studioUrl) ?? 'exports');

/** Every directory under the root that holds a published page. */
const sites = (dir, found = []) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  if (names.has('index.html') && names.has('document.json') && names.has('manifest.json')) found.push(dir);
  for (const entry of entries.filter((e) => e.isDirectory())) sites(join(dir, entry.name), found);
  return found;
};

const writeAtomic = (file, content) => {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
};

const found = sites(root);
if (found.length === 0) {
  console.log(`republish: no published apps under ${root}`);
  process.exit(0);
}

let done = 0;
let skipped = 0;
for (const dir of found) {
  const label = dir.slice(root.length + 1) || '.';
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const parsed = MadDocumentSchema.safeParse(JSON.parse(readFileSync(join(dir, 'document.json'), 'utf8')));
    if (!parsed.success) throw new Error('document.json does not match the current schema');
    if (manifest.generator !== 'mad-studio' || !manifest.deploymentId) throw new Error('manifest.json is not a MAD Studio deployment');

    const options = {
      title: manifest.title,
      description: `${manifest.title} — built with MAD Studio`,
      target: manifest.target === 'production' ? 'production' : 'preview',
      version: Number(manifest.version) || 1,
      deployedAt: manifest.deployedAt,
      deploymentId: manifest.deploymentId,
      ...(studioUrl ? { studioUrl } : {}),
    };
    const html = renderDocumentHtml(parsed.data, options);
    if (!html.includes(`data-mad-deployment="${manifest.deploymentId}"`)) throw new Error('rendered page lost its deployment marker');

    const before = statSync(join(dir, 'index.html')).size;
    if (!dryRun) {
      writeAtomic(join(dir, 'index.html'), html);
      writeAtomic(join(dir, 'manifest.json'), JSON.stringify({ ...buildManifest(parsed.data, options), url: manifest.url, projectId: manifest.projectId }, null, 2));
    }
    done += 1;
    console.log(`  ${dryRun ? 'would rebuild' : 'rebuilt'}  ${label}  ${(before / 1024).toFixed(0)}kb -> ${(html.length / 1024).toFixed(0)}kb`);
  } catch (error) {
    skipped += 1;
    console.log(`  skipped        ${label}  (${error instanceof Error ? error.message : String(error)})`);
  }
}

console.log(`republish: ${done} rebuilt, ${skipped} skipped, under ${root}`);
if (skipped > 0 && done === 0) process.exit(1);
