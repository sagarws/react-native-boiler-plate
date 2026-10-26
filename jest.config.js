module.exports = {
  preset: '@react-native/jest-preset',
  // Tests run as Android. The preset otherwise resolves `Platform.OS` to ios,
  // so Android-only branches would never run under test. Switch to 'ios' (or
  // add a second project) if iOS-specific code needs coverage.
  haste: { defaultPlatform: 'android', platforms: ['android', 'native'] },
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The RN preset only transforms `react-native` / `@react-native` packages.
  // React Navigation and the other libraries below ship untranspiled ESM, so
  // Jest chokes on their `export` statements unless they're transformed too.
  // Add any new ESM-only dependency to this list.
  transformIgnorePatterns: [
    'node_modules/(?!(?:' +
      [
        '@react-native',
        'react-native',
        '@react-navigation',
        'react-native-safe-area-context',
        'react-native-screens',
      ].join('|') +
      ')/)',
  ],
};
