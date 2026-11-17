import 'reflect-metadata';
import '@legacy/utils/logger';
import { loadEnv } from '../config/env';
loadEnv();
import { connectMongo } from '../core/db/mongo';
import { enterLegacyRoot, installLegacyProcessHandlers } from '../core/runtime/legacy-runtime';
import { createOrderServerApp } from './bootstrap';

/**
 * OrderServer (legacy src/OrderServer/server.ts) HTTP routes on Nest/Fastify.
 * NOT included until Phase 6 worker cutover: orderWorker, whatsappWorker, bull-board (/files/queues)
 * — they keep running in the legacy OrderServer process.
 */
const main = async () => {
  installLegacyProcessHandlers();
  console.log(`cwd → ${enterLegacyRoot()}`);
  await connectMongo();
  const app = await createOrderServerApp();
  const port = Number(process.env.ORDER_SERVER_PORT || 8101);
  await app.listen(port, '0.0.0.0');
  console.log(`Nest OrderServer running at http://localhost:${port}`);
};

main().catch((err) => {
  console.error('Startup failed:', err?.message || err);
  process.exit(1);
});
