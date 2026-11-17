#!/usr/bin/env node
/**
 * Seeds the LOCAL contract-test database with a company, roles, users and a system admin, so both
 * servers accept the same tokens. Refuses non-local / prod targets. Idempotent (fixed ids).
 * Prints bearer tokens for the contract cases (signed with the local-only JWT secret).
 *   node scripts/seed-local.js   → writes test/contract/.tokens.json (gitignored)
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

const URI = process.env.CONTRACT_MONGO_URI || 'mongodb://localhost:27017/trackvid_dev';
const SECRET = 'local-dev-only-secret';
const u = new URL(URI.replace(/^mongodb(\+srv)?:/, 'http:'));
const dbName = u.pathname.replace(/^\//, '');
if (!['localhost', '127.0.0.1'].includes(u.hostname) || !dbName || dbName === 'prod') { console.error('refusing: local non-prod DB only'); process.exit(1); }

const id = (hex) => new ObjectId(hex.padEnd(24, '0'));
const companyId = id('c0ffee000001');
const roleAdmin = id('a0000000000a');
const roleCustom = id('a0000000000b');
const userAdmin = id('b0000000000a');
const userCustom = id('b0000000000b');
const sysAdmin = id('d0000000000a');
const now = new Date('2026-01-01T00:00:00Z');

(async () => {
  const client = await MongoClient.connect(URI);
  const db = client.db(dbName);
  const up = (col, doc) => db.collection(col).replaceOne({ _id: doc._id }, doc, { upsert: true });
  const pw = bcrypt.hashSync('Secret#123', 10);
  await up('roles', { _id: roleAdmin, name: 'admin', description: null, permission: {}, createdAt: now, updatedAt: now });
  await up('roles', { _id: roleCustom, name: 'viewer', companyId, createdBy: userAdmin, permission: { settings: { view: true } }, createdAt: now, updatedAt: now });
  await up('companies', { _id: companyId, name: 'Contract Co', email: 'contract@local.test', createdAt: now, updatedAt: now });
  await up('users', { _id: userAdmin, name: { firstName: 'Con', lastName: 'Admin', fullName: 'Con Admin' }, email: 'admin@local.test', password: pw, phone: '9000000000', role: roleAdmin, companyId, isDisable: false, isDeleted: false, isEmailVerified: true, createdAt: now, updatedAt: now });
  await up('users', { _id: userCustom, name: { firstName: 'Con', lastName: 'Viewer', fullName: 'Con Viewer' }, email: 'viewer@local.test', password: pw, role: roleCustom, companyId, isDisable: false, isDeleted: false, isEmailVerified: true, createdAt: now, updatedAt: now });
  await up('systemadmins', { _id: sysAdmin, email: 'sys@local.test', role: 'system-admin', createdAt: now, updatedAt: now });
  await up('credits', { _id: id('e0000000000a'), companyId, totalCredit: 100, usedCredit: 0, remainingCredit: 100, totalStorage: 1024, usedStorage: 0, remainingStorage: 1024, createdAt: now, updatedAt: now });
  const sign = (p) => jwt.sign(p, SECRET, { expiresIn: '7d' });
  const tokens = {
    admin: sign({ id: String(userAdmin), role: String(roleAdmin), companyId: String(companyId) }),
    viewer: sign({ id: String(userCustom), role: String(roleCustom), companyId: String(companyId) }),
    sys: sign({ id: String(sysAdmin) }),
  };
  const out = path.join(__dirname, '..', 'test', 'contract', '.tokens.json');
  fs.writeFileSync(out, JSON.stringify(tokens, null, 2));
  console.log(`seeded ${dbName}; tokens → ${path.relative(process.cwd(), out)}`);
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
