import Module from 'module';
import path from 'path';

/**
 * Legacy modules that must never load in the Nest process because loading them starts a worker.
 * Key: path suffix of the legacy file (without extension). Value: shim module.
 * Installed by main.ts BEFORE any legacy import; jest uses the same table (jest.config.js).
 */
export const WORKER_SHIMS: Record<string, string> = {
  'controllers/MasterImport/masterImportWorker': path.join(__dirname, 'masterImportWorker.shim'),
};

let installed = false;
export const installWorkerShims = (): void => {
  if (installed) return;
  installed = true;
  const M: any = Module;
  const original = M._resolveFilename;
  M._resolveFilename = function resolveWithShims(request: string, parent: any, ...rest: any[]) {
    const resolved: string = original.call(this, request, parent, ...rest);
    const normalized = resolved.split(path.sep).join('/').replace(/\.(ts|js)$/, '');
    for (const [suffix, shim] of Object.entries(WORKER_SHIMS)) {
      if (normalized.endsWith(`/legacy/src/${suffix}`)) return original.call(this, shim, parent, ...rest);
    }
    return resolved;
  };
};

installWorkerShims();
