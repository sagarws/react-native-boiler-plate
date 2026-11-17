import 'reflect-metadata';
// MUST stay first: redirects legacy files whose import would start a worker (see core/runtime/shims)
import './core/runtime/shims';
// MUST stay before any legacy import: legacy modules read process.env at load time
import './config/load-env';
// Same console → winston override as legacy server.ts (IST timestamps + caller file:line in logs).
import '@legacy/utils/logger';
import { connectMongo } from './core/db/mongo';
import { createApp } from './bootstrap';
import { startNotificationStream } from '@legacy/utils/notificationStream';
import { runUploadsCleanupOnBoot, startUploadsCleanupInterval } from '@legacy/utils/uploadsCleanup';
import { enterLegacyRoot, installGracefulShutdown, installLegacyProcessHandlers } from './core/runtime/legacy-runtime';
import { isLegacyBackgroundOn, startLegacyBackground } from './core/runtime/legacy-background';
import { ensureCmsAppDir } from '@legacy/controllers/DesktopApp/cmsApp.controller';

// NOTE: no legacy worker / cron / socket-init imports here until Phase 5/6 (would duplicate jobs).
const main = async () => {
  installLegacyProcessHandlers();
  let server: any;
  installGracefulShutdown(() => server, '');
  // cwd = legacy root equivalent, so multer's "uploads/" and utils/files.ts's __dirname paths agree
  console.log(`cwd → ${enterLegacyRoot()}`);
  await connectMongo();
  console.log('MongoDB connected');
  // Read-only change stream that pushes to SSE clients of THIS process (/api/notifications/sse).
  // Not a worker/cron: it writes nothing; legacy runs its own for its own SSE clients.
  startNotificationStream();
  // Per-process scratch cleanup of THIS server's uploads/ (legacy server.ts does the same for its own)
  runUploadsCleanupOnBoot();
  startUploadsCleanupInterval();
  ensureCmsAppDir(); // legacy server.ts creates <cwd>/cmsapp on boot
  const app = await createApp();
  const port = Number(process.env.PORT || 8100);
  await app.listen(port, '0.0.0.0');
  server = app.getHttpServer();
  if (isLegacyBackgroundOn()) startLegacyBackground(server);
  else console.log('[legacy-background] off — workers/crons/Socket.IO stay in the legacy process (set LEGACY_BACKGROUND=on at cutover)');
  console.log(`Nest (Fastify) running at http://localhost:${port}`);
};

main().catch((err) => {
  console.error('Startup failed:', err?.message || err);
  process.exit(1);
});
