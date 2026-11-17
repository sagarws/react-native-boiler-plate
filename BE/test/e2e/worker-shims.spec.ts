import path from 'path';

/**
 * The worker shims must expose exactly what the real legacy modules export (minus the worker).
 * Loads the REAL legacy masterImportWorker.ts with BullMQ's Worker stubbed, so nothing starts.
 */
describe('worker shims match the legacy modules they replace', () => {
  it('masterImportWorker: invalidTransitions + IMPORT_PLATFORM identical', () => {
    const shim = require('../../src/core/runtime/shims/masterImportWorker.shim');
    let real: any;
    const started: string[] = [];
    jest.isolateModules(() => {
      jest.doMock('bullmq', () => ({ ...jest.requireActual('bullmq'), Worker: class { constructor(name: string) { started.push(name); } on() { return this; } close() { return Promise.resolve(); } } }));
      // absolute path: bypasses the '^./masterImportWorker$' jest mapping on purpose
      real = require(path.resolve(__dirname, '../../legacy/src/controllers/MasterImport/masterImportWorker.ts'));
    });
    expect(shim.invalidTransitions).toEqual(real.invalidTransitions);
    expect(shim.IMPORT_PLATFORM).toEqual(real.IMPORT_PLATFORM);
    expect(Object.keys(real).sort()).toEqual(['IMPORT_PLATFORM', 'default', 'invalidTransitions']);
  });

  it('the runtime redirect sends the legacy path to the shim', () => {
    const { WORKER_SHIMS } = require('../../src/core/runtime/shims');
    expect(Object.keys(WORKER_SHIMS)).toEqual(['controllers/MasterImport/masterImportWorker']);
  });
});
