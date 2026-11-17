import 'reflect-metadata';
// Same console → winston override as legacy server.ts (IST timestamps + caller file:line in logs).
import '@legacy/utils/logger';
import { loadEnv } from './config/env';
loadEnv();
import { connectMongo } from './core/db/mongo';
import { createApp } from './bootstrap';

// NOTE: no legacy worker / cron / socket-init imports here until Phase 5/6 (would duplicate jobs).
const main = async () => {
  await connectMongo();
  console.log('MongoDB connected');
  const app = await createApp();
  const port = Number(process.env.PORT || 8100);
  await app.listen(port, '0.0.0.0');
  console.log(`Nest (Fastify) running at http://localhost:${port}`);
};

main().catch((err) => {
  console.error('Startup failed:', err?.message || err);
  process.exit(1);
});
