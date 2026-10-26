module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // `void somePromise()` is the explicit marker for a deliberately
    // unawaited call — the form @typescript-eslint/no-floating-promises
    // itself recommends. Only the statement position is allowed; `void` in an
    // expression is still flagged.
    'no-void': ['warn', { allowAsStatement: true }],
  },
  settings: {
    'import/resolver': {
      'babel-module': {},
    },
  },
  overrides: [
    {
      // Build-time helpers run under Node, not the RN runtime, so they need
      // the Node globals (Buffer, process, __dirname) the RN config omits.
      files: ['scripts/**/*.js'],
      env: { node: true },
    },
    {
      // Jest globals aren't in scope for the RN eslint config outside of
      // files it recognises as tests; the setup file uses them at module top
      // level to register native-module mocks.
      files: ['jest.setup.js', 'jest.config.js'],
      env: { node: true, jest: true },
    },
  ],
  ignorePatterns: ['node_modules/', 'ios/Pods/', 'android/build/', 'android/app/build/'],
};
