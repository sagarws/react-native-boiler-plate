import 'reflect-metadata';
// Same console → winston override as legacy server.ts (IST timestamps + caller file:line in logs).
import '@legacy/utils/logger';
import { loadEnv } from './config/env';
loadEnv();
import { connectMongo } from './core/db/mongo';
import { createApp } from './bootstrap';
import { startNotificationStream } from '@legacy/utils/notificationStream';
import { runUploadsCleanupOnBoot, startUploadsCleanupInterval } from '@legacy/utils/uploadsCleanup';
import { enterLegacyRoot, installLegacyProcessHandlers } from './core/runtime/legacy-runtime';

// NOTE: no legacy worker / cron / socket-init imports here until Phase 5/6 (would duplicate jobs).
const main = async () => {
  installLegacyProcessHandlers();
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
  const app = await createApp();
  const port = Number(process.env.PORT || 8100);
  await app.listen(port, '0.0.0.0');
  console.log(`Nest (Fastify) running at http://localhost:${port}`);
};

main().catch((err) => {
  console.error('Startup failed:', err?.message || err);
  process.exit(1);
});
