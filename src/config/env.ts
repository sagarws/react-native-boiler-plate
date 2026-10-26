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
  if (value === 'development' || value === 'staging' || value === 'production') {
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

export const env: Env = load();
