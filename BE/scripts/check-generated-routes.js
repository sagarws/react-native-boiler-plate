#!/usr/bin/env node
/**
 * Cross-checks a generated controller against PROGRESS.txt (built by a different parser,
 * scripts/api-progress.js): every "METHOD /prefix/path" must exist there and counts must match.
 *   node scripts/check-generated-routes.js <controller.ts> <prefix>
 */
const fs = require('fs');
const [file, prefix] = process.argv.slice(2);
const src = fs.readFileSync(file, 'utf8');
const gen = [...src.matchAll(/legacy line \d+: ([A-Z]+) (\S*) ?\*\//g)].map(([, m, p]) => `${m} ${(prefix + (p === '/' || p === '' ? '' : p)).replace(/\/+/g, '/')}`);
const progress = fs.readFileSync(require('path').join(__dirname, '..', 'PROGRESS.txt'), 'utf8')
  .split('\n').map((l) => /^\[[ x]\] \[main\] ([A-Z]+)\s+(\S+)$/.exec(l)).filter(Boolean).map(([, m, p]) => `${m} ${p}`);
const inPrefix = progress.filter((e) => e.split(' ')[1] === prefix || e.split(' ')[1].startsWith(prefix + '/'));
const missing = gen.filter((g) => !progress.includes(g));
const extra = inPrefix.filter((e) => !gen.includes(e));
console.log(`${file}: generated ${gen.length}, PROGRESS.txt under ${prefix}: ${inPrefix.length}`);
if (missing.length) console.log('  not in PROGRESS.txt:', missing);
if (extra.length) console.log('  in PROGRESS.txt but not generated:', extra);
process.exit(missing.length || extra.length ? 1 : 0);
