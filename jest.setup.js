/**
 * Native modules have no implementation under Jest's Node environment —
 * importing one throws `TurboModuleRegistry.getEnforcing(...) could not be
 * found`. Each mock below is the smallest surface this app actually calls;
 * widen one when a test needs more, and drop it if you remove the dependency.
 */

jest.mock('react-native-localize', () => ({
  getLocales: () => [
    { countryCode: 'GB', languageTag: 'en-GB', languageCode: 'en', isRTL: false },
  ],
}));

// In-memory stand-in for MMKV. Instance-scoped so one test's writes can't
// leak into another through a shared module-level map.
jest.mock('react-native-mmkv', () => ({
  MMKV: class {
    constructor() {
      this.store = new Map();
    }
    getString(key) {
      return this.store.get(key);
    }
    getBoolean(key) {
      return this.store.get(key);
    }
    getNumber(key) {
      return this.store.get(key);
    }
    contains(key) {
      return this.store.has(key);
    }
    set(key, value) {
      this.store.set(key, value);
    }
    delete(key) {
      this.store.delete(key);
    }
    clearAll() {
      this.store.clear();
    }
  },
}));

// `config/env.ts` throws on a missing API_BASE_URL / invalid APP_ENV, so these
// two must be present for any module that transitively imports the config.
jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    API_BASE_URL: 'https://api.test.local',
    APP_ENV: 'development',
    SENTRY_DSN: '',
  },
}));

jest.mock('react-native-permissions', () => ({
  checkNotifications: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestNotifications: jest.fn().mockResolvedValue({ status: 'granted' }),
  check: jest.fn().mockResolvedValue('granted'),
  request: jest.fn().mockResolvedValue('granted'),
  PERMISSIONS: { ANDROID: {}, IOS: {} },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', BLOCKED: 'blocked' },
}));

// Socket.IO would open a real connection on import of the realtime singleton.
jest.mock('socket.io-client', () => ({
  io: () => ({
    connected: false,
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(),
  }),
}));

// SafeAreaProvider renders nothing until the native layout reports insets,
// which never happens under Jest — without this the whole navigation tree
// mounts as `null` and screen tests silently assert against an empty render.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

// File Management: Google Sign-In and the system file picker are native.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({ type: 'cancelled', data: null }),
    signInSilently: jest.fn().mockResolvedValue({ type: 'noSavedCredentialFound', data: null }),
    signOut: jest.fn().mockResolvedValue(null),
    revokeAccess: jest.fn().mockResolvedValue(null),
    hasPreviousSignIn: jest.fn(() => false),
    getCurrentUser: jest.fn(() => null),
    getTokens: jest.fn().mockResolvedValue({ accessToken: 'test-token', idToken: null }),
    clearCachedAccessToken: jest.fn().mockResolvedValue(null),
    addScopes: jest.fn().mockResolvedValue(null),
  },
  isSuccessResponse: response => response?.type === 'success',
  isErrorWithCode: error => Boolean(error && typeof error.code === 'string'),
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
  },
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn().mockResolvedValue([]),
  types: { allFiles: '*/*', images: 'image/*' },
  keepLocalCopy: jest.fn().mockResolvedValue([{ status: 'success', localUri: 'file:///copy.jpg', sourceUri: '' }]),
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: error => Boolean(error && typeof error.code === 'string'),
}));
