import fs from 'fs';
import path from 'path';

/**
 * Directory that plays the role of the legacy repo root for this build:
 *   compiled: BE/dist/src/core/runtime → BE/dist/legacy   (legacy files compile to BE/dist/legacy/src)
 *   ts-node:  BE/src/core/runtime      → BE/legacy        (the submodule)
 * Legacy code mixes cwd-relative paths (multer "uploads/", uploadsCleanup) with
 * __dirname-relative ones (utils/files.ts → `${__dirname}/../../uploads`). They agree only when
 * cwd is the legacy root, so the Nest process runs with that cwd (see main.ts).
 */
export const legacyRoot = (dirname: string = __dirname): string => path.resolve(dirname, '..', '..', '..', 'legacy');

/** Where legacy utils/files.ts reads uploads from, for a given legacy root. */
export const legacyFilesUploadsDir = (root: string) => path.join(root, 'src', 'utils', '..', '..', 'uploads');

export const enterLegacyRoot = (dirname: string = __dirname): string => {
  const root = legacyRoot(dirname);
  process.chdir(root);
  // legacy server.ts creates uploads/ on boot
  if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
  return root;
};

/** Same process-level handlers as legacy server.ts (log, never crash). */
export const installLegacyProcessHandlers = (): void => {
  process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message, err.stack);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
  });
};
