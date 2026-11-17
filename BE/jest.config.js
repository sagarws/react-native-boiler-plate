/** Unit + in-process e2e tests (no network, no DB). Contract tests have their own config. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/e2e/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    // a few transitive deps (e.g. `cookie` via light-my-request) ship ESM only
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(cookie)/)'],
  moduleNameMapper: {
    '^@legacy/(.*)$': '<rootDir>/legacy/src/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/dist', '<rootDir>/legacy/dist'],
};
