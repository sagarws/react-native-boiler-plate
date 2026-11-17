import 'reflect-metadata';
import '../core/runtime/shims';
// MUST stay before any legacy import: legacy modules read process.env at load time
import '../config/load-env';
import '@legacy/utils/logger';
import { connectMongo } from '../core/db/mongo';
import { enterLegacyRoot, installGracefulShutdown, installLegacyProcessHandlers } from '../core/runtime/legacy-runtime';
import { createOrderServerApp } from './bootstrap';

/**
 * OrderServer (legacy src/OrderServer/server.ts) HTTP routes on Nest/Fastify.
 * NOT included until Phase 6 worker cutover: orderWorker, whatsappWorker, bull-board (/files/queues)
 * — they keep running in the legacy OrderServer process.
 */
const main = async () => {
  installLegacyProcessHandlers();
  let server: any;
  installGracefulShutdown(() => server, '[OrderServer]');
  console.log(`cwd → ${enterLegacyRoot()}`);
  await connectMongo();
  const app = await createOrderServerApp();
  const port = Number(process.env.ORDER_SERVER_PORT || 8101);
  await app.listen(port, '0.0.0.0');
  server = app.getHttpServer();
  console.log(`Nest OrderServer running at http://localhost:${port}`);
};

main().catch((err) => {
  console.error('Startup failed:', err?.message || err);
  process.exit(1);
});
