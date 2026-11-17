import fs from 'fs';
import path from 'path';

/** Entry points must load env before anything else (legacy modules read process.env at import). */
describe('env is loaded before legacy imports', () => {
  it.each(['src/main.ts', 'src/order-server/main.ts'])('%s', (file) => {
    const imports = fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8').split('\n').filter((l) => /^import /.test(l));
    const envIdx = imports.findIndex((l) => /config\/load-env'/.test(l));
    const firstLegacy = imports.findIndex((l) => /@legacy\/|bootstrap'|app\.module'|db\/mongo'/.test(l));
    expect(envIdx).toBeGreaterThanOrEqual(0);
    expect(envIdx).toBeLessThan(firstLegacy);
  });
});
