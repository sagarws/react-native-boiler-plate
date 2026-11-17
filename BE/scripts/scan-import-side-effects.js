#!/usr/bin/env node
/**
 * Lists top-level side effects in every legacy file reachable from the given entry files:
 * workers, crons, intervals, listeners, and bare top-level calls (e.g. `startWorker();`).
 * Hard rule: no legacy worker/cron/socket-init may run inside the Nest app before Phase 5/6.
 *   node scripts/scan-import-side-effects.js legacy/src/routes/X/x.routes.ts [...]
 */
const fs = require('fs');
const path = require('path');
const seen = new Set();
const resolve = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base + '.ts', base + '.js', path.join(base, 'index.ts'), base]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l));
const walk = (f) => {
  if (seen.has(f)) return; seen.add(f);
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]|require\(['"](\.[^'"]+)['"]\)/g)) {
    const r = resolve(f, m[1] || m[2] || m[3]); if (r) walk(r);
  }
};
process.argv.slice(2).forEach((e) => walk(path.resolve(e)));
const PATTERNS = [
  [/new\s+Worker\s*\(/, 'BullMQ Worker'],
  [/new\s+(Bull|Queue)\s*\(\s*['"][^'"]+['"]\s*,\s*\{[^}]*\bprocess\b/, 'Bull processor'],
  [/\.process\s*\(/, 'Bull .process()'],
  [/cron\.schedule\s*\(/, 'cron.schedule'],
  [/\bsetInterval\s*\(/, 'setInterval'],
  [/\.watch\s*\(/, 'change stream .watch()'],
  [/new\s+(IOServer|Server)\s*\(/, 'socket/server'],
];
let hits = 0;
for (const f of [...seen].sort()) {
  const lines = strip(fs.readFileSync(f, 'utf8'));
  let depth = 0;
  lines.forEach((line, i) => {
    const top = depth === 0;
    for (const [re, what] of PATTERNS) if (re.test(line)) { console.log(`${path.relative(process.cwd(), f)}:${i + 1}  ${what}${top ? ' (TOP-LEVEL)' : ''}  ${line.trim().slice(0, 90)}`); hits++; }
    if (top && /^[A-Za-z_$][\w$.]*\s*\([^)]*\)\s*;?\s*$/.test(line) && !/^(if|for|while|switch|return)\b/.test(line)) {
      console.log(`${path.relative(process.cwd(), f)}:${i + 1}  TOP-LEVEL CALL  ${line.trim().slice(0, 90)}`); hits++;
    }
    for (const c of line) { if (c === '{') depth++; else if (c === '}') depth = Math.max(0, depth - 1); }
  });
}
console.error(`${seen.size} files scanned, ${hits} finding(s)`);
