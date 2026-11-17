#!/usr/bin/env node
/**
 * Regenerates BE/PROGRESS.txt: the endpoint checklist + "APIs migrated: X / N" counter.
 *
 * Source of truth for the TOTAL: the pinned legacy submodule (BE/legacy). Every
 * endpoint registered on an Express router or app is listed.
 * Source of truth for DONE: the "[x]" marks already in PROGRESS.txt. They are kept
 * when the file is regenerated, matched by "METHOD /full/path".
 *
 * Usage:  node scripts/api-progress.js          (rescan legacy, keep marks, rewrite file)
 *         node scripts/api-progress.js --check (print the counter only, write nothing)
 *
 * Mark an endpoint done = change "[ ]" to "[x]" on its line, then run `node scripts/api-progress.js`.
 */
const fs = require('fs');
const path = require('path');

const BE = path.resolve(__dirname, '..');
const LEGACY = path.join(BE, 'legacy', 'src');
const OUT = path.join(BE, 'PROGRESS.txt');
const METHODS = 'get|post|put|patch|delete';

const read = (f) => fs.readFileSync(f, 'utf8');

/** Remove block comments and whole-line // comments (keeps "//" inside URLs on code lines). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n');
}

/** import Foo from "./x" / import { Foo } from "./x"  ->  { Foo: absPath } */
function importsOf(file) {
  const map = {};
  const re = /import\s+(?:(\w+)|\{\s*([\w\s,]+)\s*\})\s+from\s+["']([^"']+)["']/g;
  for (const m of stripComments(read(file)).matchAll(re)) {
    if (!m[3].startsWith('.')) continue;
    let abs = path.resolve(path.dirname(file), m[3]);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.ts');
    else if (!abs.endsWith('.ts')) abs += '.ts';
    const names = m[1] ? [m[1]] : m[2].split(',').map((s) => s.trim().split(/\s+as\s+/).pop());
    for (const n of names) if (n) map[n] = abs;
  }
  return map;
}

/** Endpoints declared in one file on router/app identifiers. */
function endpointsIn(file, prefix, idents) {
  const src = stripComments(read(file));
  const declared = [...src.matchAll(/(?:const|let)\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(?:express\.)?Router\(/g)].map((m) => m[1]);
  const names = new Set([...declared, ...idents]);
  const re = new RegExp(`\\b(\\w+)\\.(${METHODS})\\(\\s*["'\`]([^"'\`]*)["'\`]`, 'g');
  const out = [];
  for (const m of src.matchAll(re)) {
    if (!names.has(m[1])) continue;
    const full = (prefix + (m[3] === '/' ? '' : m[3])).replace(/\/+/g, '/') || '/';
    out.push({ method: m[2].toUpperCase(), path: full, file: path.relative(path.join(BE, 'legacy'), file) });
  }
  return out;
}

/** app.use("/prefix", X) / router.use("/prefix", X) mounts resolved through imports. */
function mountsIn(file) {
  const imp = importsOf(file);
  const src = stripComments(read(file));
  const out = [];
  for (const m of src.matchAll(/\b\w+\.use\(\s*["'`]([^"'`]*)["'`]\s*,\s*([\w.]+)/g)) {
    const target = imp[m[2]];
    if (target && fs.existsSync(target)) out.push({ prefix: m[1], file: target });
  }
  return out;
}

function collect() {
  const groups = []; // { name, process, endpoints }
  const add = (name, proc, eps) => {
    const g = groups.find((x) => x.name === name && x.process === proc);
    if (g) g.endpoints.push(...eps);
    else groups.push({ name, process: proc, endpoints: eps });
  };
  const moduleName = (f) => path.relative(path.join(LEGACY, 'routes'), f).split(path.sep)[0];

  // Main server
  const server = path.join(LEGACY, 'server.ts');
  add('Root', 'main', endpointsIn(server, '', ['app']));
  for (const m of mountsIn(server)) {
    if (m.file.endsWith(path.join('routes', 'index.ts'))) {
      for (const sub of mountsIn(m.file)) add(moduleName(sub.file), 'main', endpointsIn(sub.file, m.prefix + sub.prefix, []));
    } else {
      add(moduleName(m.file), 'main', endpointsIn(m.file, m.prefix, []));
    }
  }

  // OrderServer (separate process)
  const order = path.join(LEGACY, 'OrderServer', 'server.ts');
  if (fs.existsSync(order)) {
    add('OrderServer', 'order-server', endpointsIn(order, '', ['app']));
    for (const m of mountsIn(order)) add('OrderServer', 'order-server', endpointsIn(m.file, m.prefix, []));
  }

  // MasterImportServer (separate process)
  const mis = path.join(LEGACY, 'MasterImportServer.ts');
  if (fs.existsSync(mis)) {
    add('MasterImportServer', 'master-import-server', endpointsIn(mis, '', ['app']));
    for (const m of mountsIn(mis)) add('MasterImportServer', 'master-import-server', endpointsIn(m.file, m.prefix, []));
  }

  // Dedupe identical METHOD+path within a process (duplicate registrations = one API).
  for (const g of groups) {
    const seen = new Set();
    g.endpoints = g.endpoints.filter((e) => {
      const k = `${e.method} ${e.path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return groups.filter((g) => g.endpoints.length);
}

function previousMarks() {
  const done = new Set();
  if (!fs.existsSync(OUT)) return done;
  for (const l of read(OUT).split('\n')) {
    const m = l.match(/^\s*\[x\]\s+\[([\w-]+)\]\s+(\w+)\s+(\S+)/i);
    if (m) done.add(`${m[1]} ${m[2]} ${m[3]}`);
  }
  return done;
}

function pct(a, b) {
  return b ? ((a / b) * 100).toFixed(1) : '0.0';
}
function bar(a, b, w = 30) {
  const n = b ? Math.round((a / b) * w) : 0;
  return '[' + '#'.repeat(n) + '-'.repeat(w - n) + ']';
}

function main() {
  const groups = collect();
  const marks = previousMarks();
  const key = (g, e) => `${g.process} ${e.method} ${e.path}`;

  let total = 0, done = 0;
  for (const g of groups) {
    g.done = g.endpoints.filter((e) => marks.has(key(g, e))).length;
    total += g.endpoints.length;
    done += g.done;
  }
  const stale = [...marks].filter((k) => !groups.some((g) => g.endpoints.some((e) => key(g, e) === k)));

  const headline = `APIs migrated: ${done} / ${total}  (${pct(done, total)}%)  ${bar(done, total)}`;
  if (process.argv.includes('--check')) {
    console.log(headline);
    return;
  }

  let legacyPin = '';
  try {
    legacyPin = require('child_process').execSync('git -C legacy rev-parse --short HEAD', { cwd: BE }).toString().trim();
  } catch {
    legacyPin = 'unknown'; // submodule not checked out; the count is still from the files on disk
  }

  const L = [];
  L.push('TRACKVID-BE → NESTJS + FASTIFY : API MIGRATION PROGRESS');
  L.push('='.repeat(60));
  L.push(headline);
  L.push(`Updated: ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC   Legacy pin: ${legacyPin}`);
  L.push('');
  L.push('"Migrated" = ported to Nest AND its contract tests pass against legacy (0 diffs).');
  L.push('Generated by `node scripts/api-progress.js`. Edit only the [ ] / [x] marks; everything else is rewritten.');
  L.push('');
  L.push('PER MODULE');
  L.push('-'.repeat(60));
  const w = Math.max(...groups.map((g) => g.name.length));
  for (const g of groups) {
    const proc = g.process === 'main' ? '' : `  (${g.process})`;
    L.push(`${g.name.padEnd(w)}  ${String(g.done).padStart(3)} / ${String(g.endpoints.length).padEnd(3)} ${bar(g.done, g.endpoints.length, 20)}${proc}`);
  }
  if (stale.length) {
    L.push('');
    L.push('WARNING: marked done but no longer in legacy (route renamed/removed at the new pin):');
    for (const s of stale) L.push(`  ${s}`);
  }
  L.push('');
  L.push('CHECKLIST');
  L.push('-'.repeat(60));
  for (const g of groups) {
    L.push('');
    L.push(`## ${g.name}  ${g.done}/${g.endpoints.length}${g.process === 'main' ? '' : `  (${g.process})`}`);
    for (const e of g.endpoints) {
      const mark = marks.has(key(g, e)) ? 'x' : ' ';
      L.push(`[${mark}] [${g.process}] ${e.method.padEnd(6)} ${e.path}`);
    }
  }
  fs.writeFileSync(OUT, L.join('\n') + '\n');
  console.log(headline);
}

main();
