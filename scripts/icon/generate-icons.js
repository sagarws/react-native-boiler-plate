#!/usr/bin/env node
/*
 * Rasterises scripts/icon/brand-icon.svg into all iOS & Android launcher
 * icon variants, writes them into the right native folders, and updates
 * ios/<target>/Images.xcassets/AppIcon.appiconset/Contents.json so Xcode
 * picks them up.
 *
 * Requires `sharp`: npm i -D sharp
 *
 * Run: node scripts/icon/generate-icons.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SVG_PATH = path.join(__dirname, 'brand-icon.svg');

let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  console.error(
    'Could not load `sharp`. Install it first:\n  npm i -D sharp\n\n%s',
    err && err.message,
  );
  process.exit(1);
}

const svg = fs.readFileSync(SVG_PATH);

const IOS_TARGET = 'RNBoilerplate';
const IOS_APPICON_DIR = path.join(
  ROOT,
  'ios',
  IOS_TARGET,
  'Images.xcassets',
  'AppIcon.appiconset',
);

// iOS spec: filename → pixel size. Matches Contents.json below.
const IOS_ICONS = [
  { name: 'icon-20@2x.png', size: 40, idiom: 'iphone', spec: '20x20', scale: '2x' },
  { name: 'icon-20@3x.png', size: 60, idiom: 'iphone', spec: '20x20', scale: '3x' },
  { name: 'icon-29@2x.png', size: 58, idiom: 'iphone', spec: '29x29', scale: '2x' },
  { name: 'icon-29@3x.png', size: 87, idiom: 'iphone', spec: '29x29', scale: '3x' },
  { name: 'icon-40@2x.png', size: 80, idiom: 'iphone', spec: '40x40', scale: '2x' },
  { name: 'icon-40@3x.png', size: 120, idiom: 'iphone', spec: '40x40', scale: '3x' },
  { name: 'icon-60@2x.png', size: 120, idiom: 'iphone', spec: '60x60', scale: '2x' },
  { name: 'icon-60@3x.png', size: 180, idiom: 'iphone', spec: '60x60', scale: '3x' },
  { name: 'icon-1024.png', size: 1024, idiom: 'ios-marketing', spec: '1024x1024', scale: '1x' },
];

const ANDROID_MIPMAPS = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

async function writeRect(size, outPath) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

async function writeRound(size, outPath) {
  const radius = size / 2;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<circle cx="${radius}" cy="${radius}" r="${radius}" fill="#fff"/></svg>`,
  );
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

async function main() {
  // --- iOS ---
  fs.mkdirSync(IOS_APPICON_DIR, { recursive: true });
  for (const icon of IOS_ICONS) {
    const out = path.join(IOS_APPICON_DIR, icon.name);
    process.stdout.write(`iOS  ${icon.spec} @${icon.scale} → ${icon.name} ... `);
    await writeRect(icon.size, out);
    process.stdout.write('ok\n');
  }
  const contents = {
    images: IOS_ICONS.map(i => ({
      filename: i.name,
      idiom: i.idiom,
      scale: i.scale,
      size: i.spec,
    })),
    info: { author: 'xcode', version: 1 },
  };
  fs.writeFileSync(
    path.join(IOS_APPICON_DIR, 'Contents.json'),
    JSON.stringify(contents, null, 2) + '\n',
  );
  console.log('iOS  Contents.json updated');

  // --- Android ---
  for (const m of ANDROID_MIPMAPS) {
    const dir = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', m.dir);
    fs.mkdirSync(dir, { recursive: true });
    const sq = path.join(dir, 'ic_launcher.png');
    const rd = path.join(dir, 'ic_launcher_round.png');
    process.stdout.write(`Android ${m.dir} ${m.size}px ... `);
    await writeRect(m.size, sq);
    await writeRound(m.size, rd);
    process.stdout.write('ok\n');
  }

  console.log('\nDone. Rebuild the app: `npx react-native run-ios` / `run-android`.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
