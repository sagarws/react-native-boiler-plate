#!/usr/bin/env node
/**
 * Copies the legacy files the running code reads relative to the legacy root (= the Nest process
 * cwd, see src/core/runtime/legacy-runtime.ts) into the compiled legacy root:
 *   legacy/views  → dist/legacy/views   (ejs.renderFile("views/...") in utils/mail.ts, invoices)
 *   legacy/public → dist/legacy/public  (express.static("public"))
 * Legacy's own build does the same for views (copyfiles views/* dist/views).
 *   node scripts/copy-legacy-assets.js [targetRoot]
 */
const fs = require('fs');
const path = require('path');
const BE = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || path.join(BE, 'dist', 'legacy'));
let n = 0;
for (const dir of ['views', 'public']) {
  const from = path.join(BE, 'legacy', dir);
  if (!fs.existsSync(from)) { console.error(`missing ${from}`); process.exit(1); }
  fs.cpSync(from, path.join(target, dir), { recursive: true });
  n++;
}
console.log(`copied ${n} legacy asset dirs into ${path.relative(BE, target) || '.'}`);
