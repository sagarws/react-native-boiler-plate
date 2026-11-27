import Config from 'react-native-config';

type AppEnv = 'development' | 'staging' | 'production';

type Env = {
  apiBaseUrl: string;
  sentryDsn: string | undefined;
  appEnv: AppEnv;
};

function requireValue(key: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `[config] Missing required environment variable: ${key}. Check your .env file.`,
    );
  }
  return value.trim();
}

function parseAppEnv(value: string | undefined): AppEnv {
  if (
    value === 'development' ||
    value === 'staging' ||
    value === 'production'
  ) {
    return value;
  }
  throw new Error(
    `[config] Invalid APP_ENV: "${value}". Expected development | staging | production.`,
  );
}

function load(): Env {
  return {
    apiBaseUrl: requireValue('API_BASE_URL', Config.API_BASE_URL),
    sentryDsn: Config.SENTRY_DSN || undefined,
    appEnv: parseAppEnv(Config.APP_ENV),
  };
}

let loaded: Env | null = null;
const read = (): Env => (loaded ??= load());

/**
 * Validated on first use rather than at import, so a build without the
 * backend values (auth is off) can still read the other settings below.
 */
export const env: Env = {
  get apiBaseUrl() {
    return read().apiBaseUrl;
  },
  get sentryDsn() {
    return read().sentryDsn;
  },
  get appEnv() {
    return read().appEnv;
  },
};

/**
 * The password for the hidden tab-access panel (tap the drawer logo 5 times).
 * FEATURE_ACCESS_PASSWORD in .env; empty = the panel cannot be unlocked.
 */
export const featureAccessPassword = (): string =>
  (Config.FEATURE_ACCESS_PASSWORD ?? '').trim();

/**
 * Share Live Camera: the streaming server the app starts with
 * (LIVE_CAMERA_SERVER in .env, e.g. https://203-0-113-25.sslip.io). The
 * user can change it in the feature's settings. Empty = asked in the app.
 */
export const liveCameraServerDefault = (): string =>
  (Config.LIVE_CAMERA_SERVER ?? '').trim().replace(/\/+$/, '');

// GOOGLE_DRIVE_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _FOLDER_ID are
// intentionally NOT read here: they are secrets the native
// DriveCredentialStore reads directly, so JS never holds them. JS only sees
// their status (configured, client id, folder id, 4-char hints).
