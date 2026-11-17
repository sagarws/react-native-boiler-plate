import http from 'http';
import https from 'https';

describe('test network guard', () => {
  it('blocks non-loopback connections', async () => {
    const err = await new Promise<any>((resolve) => https.get('https://api.github.com/', () => resolve(null)).on('error', resolve));
    expect(String(err?.message || err)).toMatch(/network guard|ECONNREFUSED|ENOTFOUND/);
  });
  it('allows loopback', async () => {
    const srv = http.createServer((_q, s) => s.end('ok'));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const body = await new Promise<string>((resolve) => http.get({ host: '127.0.0.1', port: (srv.address() as any).port }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(b)); }));
    expect(body).toBe('ok');
    srv.close();
  });
  it('puppeteer cannot launch', async () => {
    const puppeteer = require('puppeteer');
    await expect(puppeteer.launch()).rejects.toThrow(/disabled in tests/);
  });
});
