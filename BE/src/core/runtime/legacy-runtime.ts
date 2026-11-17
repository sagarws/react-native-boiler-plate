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

/**
 * Same graceful shutdown as legacy server.ts. Required, not cosmetic: legacy config/redis.ts adds
 * SIGINT/SIGTERM listeners, and once any listener exists Node no longer exits on those signals —
 * without this the process ignores PM2 stop/reload.
 */
export const installGracefulShutdown = (getServer: () => { close: (cb?: () => void) => unknown } | undefined, label = ''): void => {
  const shutdown = async (signal: string) => {
    console.log(`${label}[${signal}] Graceful shutdown initiated...`);
    try {
      const server = getServer();
      if (server) server.close(() => console.log(`${label}[Shutdown] HTTP server closed.`));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      await require('mongoose').connection.close();
      console.log(`${label}[Shutdown] MongoDB connection closed.`);
      console.log(`${label}[Shutdown] Cleanup complete. Exiting.`);
      process.exit(0);
    } catch (err) {
      console.error(`${label}[Shutdown] Error during cleanup:`, err);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};
