import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { execFileSync } from 'child_process';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { securityHeaders } from '@legacy/middleware/securityHeaders.middleware';
import { createApp } from '../../src/bootstrap';
import { pick, send } from '../support/parity';

const BE = path.resolve(__dirname, '..', '..');

describe('express.static("public") parity (cwd = legacy root)', () => {
  const cwd = process.cwd();
  let legacy: http.Server;
  let nest: NestFastifyApplication;
  let lp: number;
  let np: number;
  @Controller() class R { @Get('api/x') x() { return { ok: true }; } }
  @Module({ controllers: [R] }) class M {}

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-parity-'));
    fs.mkdirSync(path.join(dir, 'public', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public', 'assets', 'logo.svg'), '<svg/>');
    fs.writeFileSync(path.join(dir, 'public', 'robots.txt'), 'User-agent: *');
    process.chdir(dir);
    const app = express();
    app.set('trust proxy', 'loopback');
    app.disable('x-powered-by');
    app.use(securityHeaders);
    app.use(cors());
    app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));
    app.use(express.json({ limit: '5mb' }));
    app.use(express.static(path.join('public')));
    app.get('/api/x', (_q, s) => { s.json({ ok: true }); });
    legacy = http.createServer(app);
    lp = await new Promise<number>((r) => legacy.listen(0, '127.0.0.1', () => r((legacy.address() as any).port)));
    nest = await createApp(M);
    await nest.listen(0, '127.0.0.1');
    np = (nest.getHttpServer().address() as any).port;
  });
  afterAll(async () => { process.chdir(cwd); await nest.close(); await new Promise((r) => legacy.close(r)); });

  it.each([
    ['GET', '/assets/logo.svg', {}],
    ['GET', '/robots.txt', {}],
    ['HEAD', '/robots.txt', {}],
    ['GET', '/assets/', {}],
    ['GET', '/assets', {}],
    ['GET', '/missing.png', {}],
    ['POST', '/robots.txt', {}],
    ['GET', '/api/x', {}],
    ['GET', '/../package.json', {}],
  ] as [string, string, Record<string, string>][])('%s %s', async (method, p, headers) => {
    const a = await send(lp, { method, path: p, headers });
    const b = await send(np, { method, path: p, headers });
    const strip = (x: any) => { const v = pick(x); return v; };
    const la = strip(a); const lb = strip(b);
    // serve-static emits Last-Modified/ETag from the same file → identical
    expect(lb).toEqual(la);
    expect(b.headers['last-modified']).toBe(a.headers['last-modified']);
  });

  it('conditional GET → 304 on both', async () => {
    const first = await send(lp, { method: 'GET', path: '/robots.txt' });
    const h = { 'if-none-match': String(first.headers.etag) };
    const a = await send(lp, { method: 'GET', path: '/robots.txt', headers: h });
    const b = await send(np, { method: 'GET', path: '/robots.txt', headers: h });
    expect([b.status, b.body]).toEqual([a.status, a.body]);
    expect(a.status).toBe(304);
  });
});

describe('legacy assets copied into the compiled legacy root', () => {
  it('copies views/ and public/ (every template legacy renders exists)', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
    execFileSync('node', [path.join(BE, 'scripts/copy-legacy-assets.js'), target], { cwd: BE });
    const rendered = [...new Set([...execFileSync('grep', ['-rhoE', 'views/[a-z_]+\\.ejs', path.join(BE, 'legacy/src')], { encoding: 'utf8' }).matchAll(/views\/[a-z_]+\.ejs/g)].map((m) => m[0]))];
    expect(rendered.length).toBeGreaterThan(5);
    for (const v of rendered) expect(fs.existsSync(path.join(target, v))).toBe(true);
    expect(fs.existsSync(path.join(target, 'public'))).toBe(true);
  });
});
