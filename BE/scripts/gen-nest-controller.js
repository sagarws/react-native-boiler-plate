#!/usr/bin/env node
/**
 * Generates a Nest controller from a legacy Express route file (delegation pattern).
 *
 *   node scripts/gen-nest-controller.js <legacy route file> <url prefix> <ClassName> [out.ts]
 *   e.g. node scripts/gen-nest-controller.js legacy/src/routes/Email/email.routes.ts /api/emails Email
 *
 * Output: one Nest route per legacy route, same method + path, same middleware chain in the same
 * order (`@Legacy(...)`), handler run via `delegate()` on Express req/res. Module-level statements
 * of the route file (uploaders, limiters, consts) are copied verbatim. Inline handlers are copied.
 *
 * It refuses to guess. Anything needing a human is reported as a WARNING and marked TODO-REVIEW:
 *  - ORDER: a param route declared BEFORE a static route that it would shadow in Express
 *    (Express = first match, Fastify = static wins) → behaviour differs.
 *  - WILDCARD / REGEX path params (`:key(*)`, `(\\d+)`, `*`) → use core/http/express-wildcard.
 *  - router.use / route(), mounted sub-routers, duplicate METHOD+path registrations.
 * Exit code 2 when there are warnings.
 */
const fs = require('fs');
const path = require('path');

const [file, prefix, className, outFile] = process.argv.slice(2);
if (!file || !prefix || !className) {
  console.error('usage: gen-nest-controller.js <route file> <prefix> <ClassName> [out]');
  process.exit(1);
}
const BE = path.resolve(__dirname, '..');
const abs = path.resolve(file);
const src = fs.readFileSync(abs, 'utf8');
const warnings = [];

/** Split top-level comma-separated arguments (respects (), [], {}, strings, template literals). */
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\') { cur += s[++i]; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Find the matching close paren starting at index of '('. */
function matchParen(s, open) {
  let depth = 0, q = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 1; continue; }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
const code = stripComments(src);

// ---- imports -------------------------------------------------------------------------------------
const importRe = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g;
const imports = [];
const importedNames = new Set();
for (const m of code.matchAll(importRe)) {
  const clause = m[1].trim();
  const spec = m[2];
  // express imports are kept verbatim: leftover module-level code may use its types/helpers
  if (spec === 'express' || spec.startsWith('express/')) { imports.push({ clause, target: spec, start: m.index, end: m.index + m[0].length }); continue; }
  let target = spec;
  if (spec.startsWith('.')) {
    const resolved = path.resolve(path.dirname(abs), spec);
    const rel = path.relative(path.join(BE, 'legacy', 'src'), resolved).split(path.sep).join('/');
    target = `@legacy/${rel}`;
  }
  imports.push({ clause, target, start: m.index, end: m.index + m[0].length });
  clause.replace(/[{}]/g, ' ').split(/[\s,]+/).filter(Boolean).forEach((n) => { if (n !== 'as' && n !== 'type' && n !== '*') importedNames.add(n); });
}

// ---- router identifiers ----------------------------------------------------------------------------
const routerNames = new Set();
for (const m of code.matchAll(/(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*[\w.]+)?\s*=\s*(?:express\.)?Router\s*\(/g)) routerNames.add(m[1]);
if (!routerNames.size) warnings.push('no Router() declaration found');

// ---- route registrations ----------------------------------------------------------------------------
const routes = [];
const consumed = []; // [start,end] ranges of statements that are routes / router decls / imports / exports
for (const imp of imports) consumed.push([imp.start, imp.end]);
const callRe = new RegExp(`\\b(${[...routerNames].join('|') || '__none__'})\\s*\\.\\s*(get|post|put|patch|delete|all|use|route)\\s*\\(`, 'g');
for (const m of code.matchAll(callRe)) {
  const open = m.index + m[0].length - 1;
  const close = matchParen(code, open);
  if (close < 0) { warnings.push(`unbalanced call at ${m.index}`); continue; }
  let end = close + 1;
  while (end < code.length && /[\s;]/.test(code[end]) && code[end] !== '\n') end++;
  consumed.push([m.index, end]);
  const method = m[2].toUpperCase();
  const args = splitArgs(src.slice(open + 1, close));
  if (method === 'USE' || method === 'ROUTE' || method === 'ALL') {
    warnings.push(`router.${m[2]}(...) at line ${src.slice(0, m.index).split('\n').length} → port by hand`);
    continue;
  }
  const pathLit = args.shift();
  const pm = /^["'`](.*)["'`]$/.exec(pathLit);
  if (!pm) { warnings.push(`non-literal path ${pathLit}`); continue; }
  const handler = args.pop();
  routes.push({ method, path: pm[1], chain: args, handler, line: src.slice(0, m.index).split('\n').length });
}
for (const m of code.matchAll(/(?:export\s+)?(?:const|let)\s+\w+\s*(?::\s*[\w.]+)?\s*=\s*(?:express\.)?Router\s*\([^)]*\)\s*;?/g)) consumed.push([m.index, m.index + m[0].length]);
for (const m of code.matchAll(/export\s+default\s+\w+\s*;?/g)) consumed.push([m.index, m.index + m[0].length]);

// ---- leftover module-level statements (consts used by routes) ----------------------------------------
consumed.sort((a, b) => a[0] - b[0]);
let leftovers = '';
let pos = 0;
for (const [s, e] of consumed) { if (s > pos) leftovers += src.slice(pos, s); pos = Math.max(pos, e); }
leftovers += src.slice(pos);
leftovers = leftovers.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

// ---- path analysis -----------------------------------------------------------------------------------
const segs = (p) => p.replace(/^\/|\/$/g, '').split('/').filter((x, i, a) => !(x === '' && a.length === 1));
const isParam = (s) => s.startsWith(':');
for (const r of routes) {
  if (/[*()?+]/.test(r.path)) {
    r.review = 'wildcard/regex/optional path param: Fastify matching differs → use core/http/express-wildcard or hand-port';
    warnings.push(`line ${r.line}: ${r.method} ${r.path} — ${r.review}`);
  }
}
// ORDER: earlier route with param at index i shadowing a later static route (Express first-match)
for (let a = 0; a < routes.length; a++) {
  for (let b = a + 1; b < routes.length; b++) {
    const A = routes[a], B = routes[b];
    if (A.method !== B.method) continue;
    const sa = segs(A.path), sb = segs(B.path);
    if (sa.length !== sb.length) continue;
    let shadows = true, differs = false;
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] === sb[i]) continue;
      if (isParam(sa[i])) { if (!isParam(sb[i])) differs = true; continue; }
      if (sa[i].toLowerCase() === sb[i].toLowerCase()) continue;
      shadows = false; break;
    }
    if (shadows && differs) {
      B.review = `shadowed in Express by earlier ${A.method} ${A.path} (line ${A.line}); Fastify would route it here`;
      warnings.push(`ORDER line ${B.line}: ${B.method} ${B.path} is unreachable in Express (shadowed by line ${A.line} ${A.path}) → hand-port`);
    }
    if (sa.join('/').toLowerCase() === sb.join('/').toLowerCase()) {
      B.review = `duplicate of line ${A.line}: Express runs only the first`;
      warnings.push(`DUPLICATE line ${B.line}: ${B.method} ${B.path} also registered at line ${A.line} → keep only the first`);
    }
  }
}

// ---- emit ---------------------------------------------------------------------------------------------
const nestMethod = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete' };
const usedNest = new Set(['Controller', 'Req', 'Res']);
routes.forEach((r) => { if (r.method !== 'POST') usedNest.add(nestMethod[r.method]); });
const ctrlPrefix = prefix.replace(/^\//, '').replace(/\/$/, '');
const methodName = (r, i) => {
  const base = (r.method.toLowerCase() + '_' + r.path.replace(/[^a-zA-Z0-9]+/g, '_')).replace(/_+$/, '').replace(/_+/g, '_');
  return `${base}_${i}`;
};
const isIdent = (s) => /^[A-Za-z_$][\w$]*$/.test(s);
const lines = [];
lines.push(`/* eslint-disable */`);
lines.push(`// GENERATED by scripts/gen-nest-controller.js from ${path.relative(BE, abs)} — review before editing.`);
lines.push(`import { ${[...usedNest].sort().join(', ')} } from '@nestjs/common';`);
lines.push(`import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';`);
for (const imp of imports) if (!imp.skip) lines.push(`import ${imp.clause} from '${imp.target}';`);
if (routes.some((r) => r.method === 'POST')) lines.push(`import { Post } from '../../core/http/routes';`);
lines.push(`import { Legacy } from '../../core/auth';`);
lines.push(`import { delegate } from '../../core/legacy/delegate';`);
lines.push(`import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';`);
lines.push('');
if (leftovers) { lines.push('// ---- module-level statements copied from the legacy route file ----'); lines.push(leftovers); lines.push(''); }
lines.push(`/** Port of legacy ${path.relative(path.join(BE, 'legacy'), abs)} — ${routes.length} routes, handlers delegated. */`);
lines.push(`@Controller('${ctrlPrefix}')`);
lines.push(`export class ${className}Controller {`);
routes.forEach((r, i) => {
  const dec = r.method === 'POST' ? 'Post' : nestMethod[r.method];
  const p = r.path === '/' || r.path === '' ? '' : r.path.replace(/^\//, '');
  const pathArg = p ? `'${p}'` : '';
  const chain = r.chain.length ? ` @Legacy(${r.chain.map((c) => `(${c}) as MW`).join(', ')})` : '';
  const h = isIdent(r.handler) ? r.handler : `(${r.handler}) as any`;
  if (r.review) lines.push(`  // TODO-REVIEW: ${r.review}`);
  lines.push(`  /** legacy line ${r.line}: ${r.method} ${r.path} */`);
  lines.push(`  @${dec}(${pathArg})${chain} ${methodName(r, i)}(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, ${h}); }`);
});
lines.push('}');
lines.push('');
const out = lines.join('\n');
if (outFile) fs.writeFileSync(outFile, out); else process.stdout.write(out);
console.error(`${routes.length} routes${warnings.length ? `, ${warnings.length} WARNING(S):\n  - ` + warnings.join('\n  - ') : ', no warnings'}`);
process.exit(warnings.length ? 2 : 0);
