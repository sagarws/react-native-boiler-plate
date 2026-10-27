// Builds the extension for distribution (no dependencies):
//   npm run build
// → ../crome-extension-dist/akshar-listen/            (Load unpacked from here)
// → ../crome-extension-dist/akshar-listen-<ver>.zip   (Chrome Web Store / sharing)
//
// The extension is plain JS, so "building" means: check the manifest and every
// file it needs, copy only runtime files (no tests, README, package.json),
// and zip them.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, '..', 'crome-extension-dist');
const RUNTIME = [
  'manifest.json',
  'background.js',
  'protocol.js',
  'offscreen.html',
  'offscreen.js',
  'pcm-player-worklet.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons',
];

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

// ── Check ────────────────────────────────────────────────────────────────

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
} catch (e) {
  fail(`manifest.json is not valid JSON: ${e.message}`);
}
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) fail(`bad version "${manifest.version}"`);

const referenced = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
]);
for (const file of RUNTIME) referenced.add(file);
// Files loaded from HTML/JS at runtime.
for (const html of ['popup.html', 'offscreen.html']) {
  for (const [, src] of readFileSync(join(root, html), 'utf8').matchAll(/(?:src|href)="([^":]+)"/g)) referenced.add(src);
}
for (const [, mod] of readFileSync(join(root, 'offscreen.js'), 'utf8').matchAll(/addModule\('([^']+)'\)/g)) referenced.add(mod);
for (const js of ['background.js', 'popup.js', 'offscreen.js']) {
  for (const [, imp] of readFileSync(join(root, js), 'utf8').matchAll(/from '\.\/([^']+)'/g)) referenced.add(imp);
}
for (const file of referenced) {
  if (file && !existsSync(join(root, file))) fail(`missing file: ${file}`);
}

// ── Copy ─────────────────────────────────────────────────────────────────

const unpacked = join(outRoot, 'akshar-listen');
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(unpacked, { recursive: true });
for (const item of RUNTIME) cpSync(join(root, item), join(unpacked, item), { recursive: true });

// ── Zip (store-compatible: deflate, forward slashes, no directories) ────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(unpacked).sort();
const locals = [];
const centrals = [];
let offset = 0;
// Fixed DOS timestamp (1 Jan 2024) so identical sources give identical zips.
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

for (const path of files) {
  const name = Buffer.from(relative(unpacked, path).split(sep).join('/'));
  const data = readFileSync(path);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += 30 + name.length + packed.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...locals, ...centrals, end]);
const zipPath = join(outRoot, `akshar-listen-${manifest.version}.zip`);
writeFileSync(zipPath, zip);

console.log(`✔ Akshar Listen ${manifest.version} — ${files.length} files`);
console.log(`  Load unpacked: ${unpacked}`);
console.log(`  Zip:           ${zipPath} (${(zip.length / 1024).toFixed(1)} KB, sha256 ${createHash('sha256').update(zip).digest('hex').slice(0, 12)}…)`);
