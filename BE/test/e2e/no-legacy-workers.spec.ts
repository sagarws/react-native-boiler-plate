import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * Hard rule (CLAUDE.md): no legacy worker / cron / socket-init may run inside the Nest app before
 * Phase 5/6. Scans every legacy file reachable from what src/ imports and fails when a file that
 * creates a Worker / cron / socket server also makes a top-level call that could start it
 * (e.g. masterImportWorker.ts ends with `startWorker();`).
 */
const BE = path.resolve(__dirname, '..', '..');
const ALLOWED_TOP_LEVEL = /Schema\.(index|pre|post|virtual|set|plugin)\(|^\s*router\.|process\.on\(|console\.(log|warn|error)\(|dotenv\.config\(|Ffmpeg\.setFfmpegPath\(|\.createIndexes\(\)|^\s*setInterval\(/;
const STARTERS = /new\s+Worker\s*\(|cron\.schedule\s*\(|new\s+IOServer\s*\(|\.process\s*\(/;

const srcFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? srcFiles(path.join(dir, d.name)) : d.name.endsWith('.ts') && !d.name.endsWith('.spec.ts') ? [path.join(dir, d.name)] : []));

describe('no legacy worker/cron/socket starts on import', () => {
  it('every legacy file reachable from src/ is free of import-time starters', () => {
    const entries = [...new Set(srcFiles(path.join(BE, 'src')).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/from '@legacy\/([^']+)'/g)].map((m) => `legacy/src/${m[1]}.ts`)))]
      .filter((f) => fs.existsSync(path.join(BE, f)));
    const out = execFileSync('node', [path.join(BE, 'scripts/scan-import-side-effects.js'), ...entries], { cwd: BE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const byFile = new Map<string, string[]>();
    for (const line of out.split('\n').filter(Boolean)) {
      const file = line.split(':')[0];
      byFile.set(file, [...(byFile.get(file) || []), line]);
    }
    const violations: string[] = [];
    for (const [file, lines] of byFile) {
      const src = fs.readFileSync(path.join(BE, file), 'utf8');
      if (!STARTERS.test(src)) continue;
      for (const l of lines) if (/TOP-LEVEL/.test(l) && !ALLOWED_TOP_LEVEL.test(l.split(/TOP-LEVEL(?: CALL)?\)?\s+/).pop() || '')) violations.push(l);
    }
    expect(violations).toEqual([]);
  });

  it('detects the known starter (masterImportWorker.ts → startWorker())', () => {
    const out = execFileSync('node', [path.join(BE, 'scripts/scan-import-side-effects.js'), 'legacy/src/controllers/MasterImport/masterImportWorker.ts'], { cwd: BE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(out).toMatch(/startWorker\(\)/);
  });
});
