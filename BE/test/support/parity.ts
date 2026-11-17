import http from 'http';
import type { AddressInfo } from 'net';

export type Captured = { status: number; headers: Record<string, string | string[] | undefined>; body: string; raw?: Buffer };
export type Req = { method: string; path: string; headers?: Record<string, string>; body?: string | Buffer };

/** Headers compared between legacy and new (volatile ones such as date/connection are skipped). */
export const COMPARED_HEADERS = [
  'content-type', 'content-length', 'etag', 'vary', 'x-powered-by',
  'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers',
  'access-control-allow-credentials', 'access-control-expose-headers', 'access-control-max-age',
  'ratelimit', 'ratelimit-policy', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'x-content-type-options', 'referrer-policy', 'content-security-policy', 'content-disposition', 'cache-control', 'location',
];

export const listen = (server: http.Server) =>
  new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

export const send = (port: number, r: Req) =>
  new Promise<Captured>((resolve, reject) => {
    const headers: Record<string, string | number> = { ...(r.headers || {}) };
    // Node's client sends DELETE/GET bodies without Content-Length or chunking unless told
    if (r.body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-length')) headers['content-length'] = Buffer.byteLength(r.body);
    const req = http.request({ host: '127.0.0.1', port, method: r.method, path: r.path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, body: raw.toString('utf8'), raw }); });
    });
    req.on('error', reject);
    if (r.body !== undefined) req.write(r.body);
    req.end();
  });

/**
 * XLSX/ZIP downloads embed per-file DOS timestamps (2 s resolution), so two identical exports made
 * a moment apart differ in a few bytes. Compare them by parsed workbook content instead.
 */
const zipAware = (c: Captured): string => {
  if (!c.raw || c.raw.length < 4 || c.raw.readUInt32LE(0) !== 0x04034b50) return c.body;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require('xlsx');
    const wb = XLSX.read(c.raw, { type: 'buffer' });
    return 'XLSX:' + JSON.stringify(wb.SheetNames.map((n: string) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null })]));
  } catch {
    return c.body;
  }
};

export const pick = (c: Captured) => ({
  status: c.status,
  body: zipAware(c),
  headers: Object.fromEntries(COMPARED_HEADERS.filter((h) => !(zipAware(c) !== c.body && (h === 'etag' || h === 'content-length'))).map((h) => [h, c.headers[h]])),
});

/** multipart/form-data body builder for upload tests. */
export const multipart = (parts: { name: string; value?: string; filename?: string; type?: string; data?: Buffer }[]) => {
  const boundary = '----parity' + 'x'.repeat(8);
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) head += `; filename="${p.filename}"\r\nContent-Type: ${p.type || 'application/octet-stream'}`;
    chunks.push(Buffer.from(head + '\r\n\r\n'), p.data ?? Buffer.from(p.value ?? ''), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(chunks) };
};
