#!/usr/bin/env node
/**
 * MAD Studio media pipeline.
 * Rasterises the SVG brand sources into every PNG / ICO the web app ships,
 * copies the vector sources and the web manifest into apps/web/public,
 * and rewrites asset-manifest.json with byte sizes and content hashes.
 *
 * Usage:  node media/build-media.mjs
 * Deps:   sharp (rasteriser), png-to-ico (favicon). Both resolved from the repo root.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const publicDir = resolve(root, 'apps/web/public');

const manifestPath = resolve(here, 'asset-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch (error) {
    throw new Error(
      `sharp is required to rasterise brand assets. Install it at the repo root with "npm i -D sharp png-to-ico".\n${String(error)}`,
    );
  }
}

async function loadPngToIco() {
  try {
    return (await import('png-to-ico')).default;
  } catch (error) {
    throw new Error(
      `png-to-ico is required to build favicon.ico. Install it at the repo root with "npm i -D sharp png-to-ico".\n${String(error)}`,
    );
  }
}

const sharp = await loadSharp();
const pngToIco = await loadPngToIco();

const iconSvg = await readFile(resolve(here, 'icon.svg'));
const ogSvg = await readFile(resolve(here, 'og-image.svg'));

await mkdir(resolve(publicDir, 'icons'), { recursive: true });
await mkdir(resolve(publicDir, 'brand'), { recursive: true });

/** @param {Buffer} svg @param {number} size */
const rasterIcon = (svg, size) => sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/**
 * Maskable icons need the artwork inside an 80% safe zone with an opaque background.
 * We paint the graphite tile edge-to-edge and centre the mark at 80%.
 */
async function buildMaskable(size) {
  const inner = Math.round(size * 0.8);
  const mark = await rasterIcon(iconSvg, inner);
  return sharp({
    create: { width: size, height: size, channels: 4, background: '#0B0D12' },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const outputs = [
  { key: 'icon192', bytes: await rasterIcon(iconSvg, 192) },
  { key: 'icon512', bytes: await rasterIcon(iconSvg, 512) },
  { key: 'iconMaskable512', bytes: await buildMaskable(512) },
  { key: 'appleTouch', bytes: await rasterIcon(iconSvg, 180) },
  { key: 'ogImage', bytes: await sharp(ogSvg, { density: 144 }).resize(1200, 630).png({ compressionLevel: 9 }).toBuffer() },
];

for (const { key, bytes } of outputs) {
  await writeFile(resolve(root, manifest.outputs[key]), bytes);
}

const icoSources = await Promise.all([16, 32, 48, 64].map((s) => rasterIcon(iconSvg, s)));
await writeFile(resolve(root, manifest.outputs.favicon), await pngToIco(icoSources));

const copies = [
  ['icon.svg', 'iconSvg'],
  ['logo.svg', 'logo'],
  ['logo-light.svg', 'logoLight'],
  ['logo-mark.svg', 'logoMark'],
  ['site.webmanifest', 'manifest'],
];
for (const [source, key] of copies) {
  await copyFile(resolve(here, source), resolve(root, manifest.outputs[key]));
}

const built = {};
for (const [key, relPath] of Object.entries(manifest.outputs)) {
  const abs = resolve(root, relPath);
  const bytes = await readFile(abs);
  const { size } = await stat(abs);
  built[key] = { path: relPath, bytes: size, sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16) };
}

manifest.built = { at: new Date().toISOString(), files: built };
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${Object.keys(built).length} brand assets into ${publicDir}`);
for (const [key, meta] of Object.entries(built)) {
  console.log(`  ${key.padEnd(16)} ${String(meta.bytes).padStart(8)} B  ${meta.path}`);
}
