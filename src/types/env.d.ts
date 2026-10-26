declare module 'react-native-config' {
  export interface NativeConfig {
    /** Backend base URL, e.g. https://api.example.com. Required, no trailing slash. */
    API_BASE_URL?: string;
    SENTRY_DSN?: string;
    APP_ENV?: 'development' | 'staging' | 'production';
  }
  const Config: NativeConfig;
  export default Config;
}
