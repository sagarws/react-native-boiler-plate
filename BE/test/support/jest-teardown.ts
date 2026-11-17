/** Close Redis clients that legacy modules opened at import (see jest-setup.ts). */
afterAll(async () => {
  const clients: any[] = (globalThis as any).__redisClients || [];
  await Promise.all(clients.splice(0).map((c) => Promise.resolve().then(() => c.disconnect?.()).catch(() => undefined)));
});
