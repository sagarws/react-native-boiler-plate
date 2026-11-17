import http from 'http';
import type { AddressInfo } from 'net';

export type Captured = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
export type Req = { method: string; path: string; headers?: Record<string, string>; body?: string | Buffer };

/** Headers compared between legacy and new (volatile ones such as date/connection are skipped). */
export const COMPARED_HEADERS = [
  'content-type', 'content-length', 'etag', 'vary', 'x-powered-by',
  'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers',
  'access-control-allow-credentials', 'access-control-expose-headers', 'access-control-max-age',
  'x-content-type-options', 'referrer-policy', 'content-security-policy', 'content-disposition', 'cache-control', 'location',
];

export const listen = (server: http.Server) =>
  new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

export const send = (port: number, r: Req) =>
  new Promise<Captured>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: r.method, path: r.path, headers: r.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (r.body !== undefined) req.write(r.body);
    req.end();
  });

export const pick = (c: Captured) => ({
  status: c.status,
  body: c.body,
  headers: Object.fromEntries(COMPARED_HEADERS.map((h) => [h, c.headers[h]])),
});
