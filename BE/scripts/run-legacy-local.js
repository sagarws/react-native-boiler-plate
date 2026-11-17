#!/usr/bin/env node
/**
 * Starts the LEGACY Express server from the submodule (BE/legacy) for local contract tests,
 * with a hand-built LOCAL-ONLY environment. It never reads the legacy repo's prod `.env`:
 *  - runs from BE/legacy (the submodule has no .env; legacy's dotenv.config() finds nothing),
 *  - the child env contains only the keys below + PATH/HOME (nothing inherited from the shell),
 *  - refuses any MONGO_URI that is not localhost or that names the `prod` database.
 *
 *   node scripts/run-legacy-local.js            (port 8000, DB trackvid_dev)
 */
const { spawn } = require('child_process');
const path = require('path');
const BE = path.resolve(__dirname, '..');

const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: 'development',
  PORT: process.env.LEGACY_PORT || '8000',
  MONGO_URI: process.env.LEGACY_MONGO_URI || 'mongodb://localhost:27017/trackvid_dev',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  JWT_SECRET: 'local-dev-only-secret', // same as BE/.env.development.local so tokens work on both
  JWT_EXPIRES_IN: '1d',
  // dummy values: legacy config/db.ts exits without them; nothing can authenticate to AWS
  AWS_ACCESS_KEY: 'local-dummy',
  AWS_SECRET_ACCESS_KEY: 'local-dummy',
  AWS_BUCKET_REGION: 'us-east-1',
  AWS_BUCKET_NAME: 'local-dummy-bucket',
  REALTIME_INTERNAL_URL: 'http://localhost:8000/internal/realtime/broadcast',
  SERVICE_NAME: 'legacy-local-contract',
};

const u = new URL(env.MONGO_URI.replace(/^mongodb(\+srv)?:/, 'http:'));
if (!['localhost', '127.0.0.1'].includes(u.hostname) || /^\/?prod\b/.test(u.pathname.replace(/^\//, ''))) {
  console.error(`refusing to start legacy against ${u.hostname}${u.pathname} — local non-prod databases only`);
  process.exit(1);
}

const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/server.ts'], {
  cwd: path.join(BE, 'legacy'),
  env: { ...env, TS_NODE_PROJECT: path.join(BE, 'legacy', 'tsconfig.json'), TS_NODE_TRANSPILE_ONLY: 'true' },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
