import fs from 'fs';
import path from 'path';

/**
 * src/core/runtime/legacy-background.ts must mirror what legacy server.ts runs in the background.
 * After a legacy pin bump this fails when server.ts gains/loses a worker import, a cron schedule
 * or a scheduler/start call that is not mirrored.
 */
const BE = path.resolve(__dirname, '..', '..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const legacy = strip(fs.readFileSync(path.join(BE, 'legacy/src/server.ts'), 'utf8'));
const mirror = strip(fs.readFileSync(path.join(BE, 'src/core/runtime/legacy-background.ts'), 'utf8'));
const mainTs = strip(fs.readFileSync(path.join(BE, 'src/main.ts'), 'utf8'));

describe('legacy background mirror', () => {
  it('every side-effect worker import of legacy server.ts is required', () => {
    const workers = [...legacy.matchAll(/^import\s+["']\.\/([^"']+)["'];?/gm)].map((m) => m[1]).filter((p) => !/logger/.test(p));
    expect(workers.length).toBeGreaterThan(5);
    for (const w of workers) expect(mirror).toContain(`require('@legacy/${w}')`);
  });

  it('every cron schedule of legacy server.ts is scheduled', () => {
    const crons = [...legacy.matchAll(/cron\.schedule\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(crons.length).toBeGreaterThan(3);
    for (const c of crons) expect(mirror).toContain(`cron.schedule("${c}"`);
  });

  it('every start/schedule/init call of legacy server.ts is made (here or in main.ts)', () => {
    const calls = [...new Set([...legacy.matchAll(/^\s*((?:start|schedule|initialize|run|ensure)[A-Z]\w*)\(/gm)].map((m) => m[1]))];
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) expect(mirror.includes(`${c}(`) || mainTs.includes(`${c}(`)).toBe(true);
  });

  it('is off unless LEGACY_BACKGROUND=on', () => {
    const { isLegacyBackgroundOn } = require('../../src/core/runtime/legacy-background');
    const prev = process.env.LEGACY_BACKGROUND;
    delete process.env.LEGACY_BACKGROUND; expect(isLegacyBackgroundOn()).toBe(false);
    process.env.LEGACY_BACKGROUND = 'true'; expect(isLegacyBackgroundOn()).toBe(false);
    process.env.LEGACY_BACKGROUND = 'on'; expect(isLegacyBackgroundOn()).toBe(true);
    if (prev === undefined) delete process.env.LEGACY_BACKGROUND; else process.env.LEGACY_BACKGROUND = prev;
  });
});

describe('legacy-background.entries.ts (compile-only)', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
  it('is never imported by any source file', () => {
    const importers = walk(path.join(BE, 'src')).filter((f) => /legacy-background\.entries/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith('legacy-background.entries.ts'));
    expect(importers).toEqual([]);
  });
  it('lists every module legacy-background.ts requires', () => {
    const entries = fs.readFileSync(path.join(BE, 'src/core/runtime/legacy-background.entries.ts'), 'utf8');
    for (const m of mirror.matchAll(/require\('(@legacy\/[^']+)'\)/g)) expect(entries).toContain(`import '${m[1]}';`);
  });
});

describe('MasterImportServer background mirror', () => {
  const mis = strip(fs.readFileSync(path.join(BE, 'legacy/src/MasterImportServer.ts'), 'utf8'));
  const misMirror = strip(fs.readFileSync(path.join(BE, 'src/master-import-server/background.ts'), 'utf8'));
  it('every worker import (static and lazy) of legacy MasterImportServer.ts is required', () => {
    const workers = [
      ...[...mis.matchAll(/^import\s+["']\.\/([^"']+)["'];?/gm)].map((m) => m[1]),
      ...[...mis.matchAll(/await\s+import\(\s*["']\.\/([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...mis.matchAll(/^import\s+(\w+)\s+from\s+["']\.\/(controllers\/WhatsApp\/whatsappMessageWorker)["']/gm)].map((m) => m[2]),
    ].filter((p) => !/logger/.test(p));
    expect(workers.length).toBeGreaterThan(8);
    for (const w of workers) expect(misMirror).toContain(`'@legacy/${w}')`);
  });
  it('every start/run call of legacy MasterImportServer.ts is made', () => {
    const calls = [...new Set([...mis.matchAll(/^\s*(?:await\s+)?((?:start|run)[A-Z]\w*)\(/gm)].map((m) => m[1]))];
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) expect(misMirror).toContain(`${c}(`);
  });
  it('both background modules run legacy migrations like legacy connectDB()', () => {
    expect(mirror).toContain('runLegacyMigrations()');
    expect(fs.readFileSync(path.join(BE, 'src/master-import-server/main.ts'), 'utf8')).toContain('runLegacyMigrations()');
  });
});
