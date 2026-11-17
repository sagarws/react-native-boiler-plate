import 'reflect-metadata';
import '../core/runtime/shims';
// MUST stay before any legacy import: legacy modules read process.env at load time
import '../config/load-env';
import '@legacy/utils/logger';
import { connectMongo } from '../core/db/mongo';
import { enterLegacyRoot, installGracefulShutdown, installLegacyProcessHandlers } from '../core/runtime/legacy-runtime';
import { isLegacyBackgroundOn } from '../core/runtime/legacy-background';
import { runLegacyMigrations } from '../core/runtime/legacy-migrations';
import { createMasterImportServerApp } from './bootstrap';
import { startMasterImportServerBackground } from './background';

/**
 * Full replacement of the legacy MasterImportServer process (HTTP + workers + crons): its routes
 * drive in-process pipeline state, so they cannot run without their workers. Refuses to start
 * unless LEGACY_BACKGROUND=on, i.e. the operator has stopped the legacy MasterImportServer.
 */
const main = async () => {
  if (!isLegacyBackgroundOn()) {
    console.error('[master-import-server] refusing to start: set LEGACY_BACKGROUND=on ONLY after stopping the legacy MasterImportServer (never run both)');
    process.exit(1);
  }
  installLegacyProcessHandlers();
  let server: any;
  installGracefulShutdown(() => server, '[MasterImportServer]');
  const port = process.env.MASTER_IMPORT_PORT;
  if (!port) {
    console.error('MASTER_IMPORT_PORT is not defined in the environment variables.');
    process.exit(1);
  }
  console.log(`cwd → ${enterLegacyRoot()}`);
  await connectMongo();
  console.log('Database connected. Now starting the server');
  runLegacyMigrations();
  await startMasterImportServerBackground();
  const app = await createMasterImportServerApp();
  await app.listen(Number(port), '0.0.0.0');
  server = app.getHttpServer();
  console.log(`Server running at http://localhost:${port}`);
};

main().catch((err) => {
  console.error('Error connecting to the database:', err);
  process.exit(1);
});
