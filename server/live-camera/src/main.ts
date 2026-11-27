import { createServer } from 'node:http';
import { createApp, VERSION } from './app.ts';
import { loadConfig } from './config.ts';
import { createMediaMtx } from './mediamtx.ts';

const config = loadConfig();
const mtx = createMediaMtx(config.mtxWebrtcUrl, config.mtxApiUrl, config.mtxSecret);
const app = createApp({ config, mtx });

const server = createServer(app.handler);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

const sweep = setInterval(() => {
  app.cleanup().catch(err => console.error('cleanup failed:', (err as Error).message));
}, 30_000);

server.listen(config.port, config.host, () => {
  console.log(`live-camera ${VERSION} listening on ${config.host}:${config.port} · public ${config.publicUrl}`);
});

const stop = () => {
  clearInterval(sweep);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
