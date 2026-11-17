/** Unit + in-process e2e tests (no network, no DB). Contract tests have their own config. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  // parity specs load the whole legacy model graph per worker; too many parallel workers
  // starve each other and requests time out (seen as flaky 5s timeouts)
  maxWorkers: '50%',
  testTimeout: 30000,
  setupFiles: ['<rootDir>/test/support/jest-setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/support/jest-teardown.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/e2e/**/*.spec.ts', '<rootDir>/test/modules/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    // a few transitive deps (e.g. `cookie` via light-my-request) ship ESM only
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(cookie)/)'],
  moduleNameMapper: {
    '^@legacy/(.*)$': '<rootDir>/legacy/src/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    // legacy file.controller.ts has one baseUrl-style type import (`src/types/...`)
    '^src/types/(.*)$': '<rootDir>/legacy/src/types/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/dist', '<rootDir>/legacy/dist'],
};
