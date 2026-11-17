const base = require('../../jest.config');
module.exports = { ...base, rootDir: '../..', testMatch: ['<rootDir>/test/contract/**/*.spec.ts'], testTimeout: 30000, maxWorkers: 1, setupFiles: [] };
