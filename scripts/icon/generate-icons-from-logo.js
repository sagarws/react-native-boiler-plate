#!/usr/bin/env node
/*
 * Builds the Android launcher icons and the in-app logo from the raster brand
 * logo at public/images/logo.png.
 *
 * That PNG has no real transparency — the "transparent" checkerboard is
 * painted into its pixels — so the round emblem is cut out first: the navy
 * border ring is located, the emblem is cropped to it, squared and masked to
 * an anti-aliased circle. From that clean master it writes:
 *
 *   android/app/src/main/res/mipmap-<dpi>/ic_launcher.png          legacy, round emblem
 *   android/app/src/main/res/mipmap-<dpi>/ic_launcher_round.png    legacy round
 *   android/app/src/main/res/mipmap-<dpi>/ic_launcher_adaptive_fore.png
 *   android/app/src/main/res/mipmap-<dpi>/ic_launcher_adaptive_back.png
 *   src/shared/assets/images/app_logo.png                          in-app logo (512px)
 *
 * The adaptive background is the emblem's own border colour, so whatever mask
 * shape the launcher applies (circle, squircle, rounded square) the emblem
 * sits on a matching navy field instead of being clipped.
 *
 * Requires `sharp` (not a project dependency): npm i -D sharp
 * Run: node scripts/icon/generate-icons-from-logo.js
 */
const fs = require('node:fs');
const path = require('node:path');

let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  console.error('Could not load `sharp`. Install it first:\n  npm i -D sharp\n\n%s', err && err.message);
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'public', 'images', 'logo.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const APP_LOGO = path.join(ROOT, 'src', 'shared', 'assets', 'images', 'app_logo.png');

const MASTER = 1024;

// Launcher sizes in px per density: legacy 48dp, adaptive layers 108dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// Adaptive icons: the launcher shows the central 72dp of the 108dp layer and
// guarantees only a 66dp circle. The emblem fills 70dp — its navy ring may be
// trimmed by tight masks, which the matching background hides.
const EMBLEM_IN_ADAPTIVE = 70 / 108;

/** The navy border ring: dark blue with little red. */
function isBorder(r, g, b) {
  return r < 50 && g > 50 && g < 100 && b > 90 && b < 150;
}

async function findEmblem() {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let minX = W, maxX = 0, minY = H, maxY = 0, n = 0, sr = 0, sg = 0, sb = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (!isBorder(r, g, b)) continue;
      n++;
      sr += r; sg += g; sb += b;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (n < 1000) throw new Error('Could not find the emblem border in ' + SOURCE);
  const hex = v => Math.round(v / n).toString(16).padStart(2, '0');
  return {
    box: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    border: `#${hex(sr)}${hex(sg)}${hex(sb)}`,
  };
}

/** Anti-aliased circle as a one-channel alpha mask (4× supersampled). */
function circleAlpha(size) {
  const ss = 4;
  const alpha = Buffer.alloc(size * size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const dx = x + (sx + 0.5) / ss - r;
          const dy = y + (sy + 0.5) / ss - r;
          if (dx * dx + dy * dy <= (r - 0.5) * (r - 0.5)) inside++;
        }
      }
      alpha[y * size + x] = Math.round((inside / (ss * ss)) * 255);
    }
  }
  return alpha;
}

/**
 * The source paints its "transparent" checkerboard inside the emblem too
 * (below the river). Its grey squares are neutral (r≈g≈b≈195–200); no part
 * of the artwork is neutral grey, so those pixels — and the white squares
 * between them, recognised by touching a grey square — are filled with a
 * soft light blue that sits between the white river and the temple blues.
 */
const HOLE_FILL = [0xdc, 0xea, 0xf4];

function isCheckerGrey(r, g, b) {
  return Math.abs(r - g) <= 6 && Math.abs(g - b) <= 6 && r >= 180 && r <= 215;
}

function fillPaintedChecker(data, W, H, C) {
  const grey = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * C;
    if (isCheckerGrey(data[p], data[p + 1], data[p + 2])) grey[i] = 1;
  }
  // A checker square is ~20px; white within that distance of grey is checker too.
  const near = new Uint8Array(W * H);
  const R = 24;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!grey[y * W + x]) continue;
      for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy += 4) {
        for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx += 4) near[yy * W + xx] = 1;
      }
    }
  }
  let filled = 0;
  for (let i = 0; i < W * H; i++) {
    const p = i * C;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const whiteChecker = near[i] && r >= 248 && g >= 248 && b >= 248;
    if (grey[i] || whiteChecker) {
      data[p] = HOLE_FILL[0];
      data[p + 1] = HOLE_FILL[1];
      data[p + 2] = HOLE_FILL[2];
      filled++;
    }
  }
  return filled;
}

async function main() {
  const { box, border } = await findEmblem();
  console.log('emblem', box, 'border', border);

  // Crop to the ring and square it (the source is ~2% elliptical).
  const { data, info } = await sharp(SOURCE)
    .removeAlpha()
    .extract(box)
    .resize(MASTER, MASTER, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Only the inside of the ring is artwork; repair painted checker there.
  const alpha = circleAlpha(MASTER);
  const filled = fillPaintedChecker(data, info.width, info.height, info.channels);
  console.log('filled painted-checker pixels:', filled);
  const master = await sharp(data, { raw: { width: MASTER, height: MASTER, channels: 3 } })
    .joinChannel(alpha, { raw: { width: MASTER, height: MASTER, channels: 1 } })
    .png()
    .toBuffer();

  const write = async (file, buffer) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
  };

  for (const [dpi, scale] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${dpi}`);
    const legacy = Math.round(48 * scale);
    const layer = Math.round(108 * scale);
    const emblem = Math.round(layer * EMBLEM_IN_ADAPTIVE);

    // Legacy icons: the round emblem with a 2dp margin, transparent corners.
    const inset = Math.round(legacy * (44 / 48));
    const pad = Math.floor((legacy - inset) / 2);
    const legacyPng = await sharp(master)
      .resize(inset, inset)
      .extend({ top: pad, left: pad, bottom: legacy - inset - pad, right: legacy - inset - pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await write(path.join(dir, 'ic_launcher.png'), legacyPng);
    await write(path.join(dir, 'ic_launcher_round.png'), legacyPng);

    const offset = Math.floor((layer - emblem) / 2);
    await write(
      path.join(dir, 'ic_launcher_adaptive_fore.png'),
      await sharp(master)
        .resize(emblem, emblem)
        .extend({ top: offset, left: offset, bottom: layer - emblem - offset, right: layer - emblem - offset, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    );
    await write(
      path.join(dir, 'ic_launcher_adaptive_back.png'),
      await sharp({ create: { width: layer, height: layer, channels: 3, background: border } }).png().toBuffer(),
    );
    console.log(`mipmap-${dpi}: legacy ${legacy}px, adaptive ${layer}px`);
  }

  await write(APP_LOGO, await sharp(master).resize(512, 512).png().toBuffer());
  console.log('in-app logo', path.relative(ROOT, APP_LOGO));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
