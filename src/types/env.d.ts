declare module 'react-native-config' {
  export interface NativeConfig {
    /** Backend base URL, e.g. https://api.example.com. Required, no trailing slash. */
    API_BASE_URL?: string;
    SENTRY_DSN?: string;
    APP_ENV?: 'development' | 'staging' | 'production';
    /**
     * File Management's default shared Google Drive. Native-only: read by
     * DriveCredentialStore from string resources, never in JS (see env.ts).
     */
    GOOGLE_DRIVE_CLIENT_ID?: string;
    GOOGLE_DRIVE_CLIENT_SECRET?: string;
    GOOGLE_DRIVE_REFRESH_TOKEN?: string;
    GOOGLE_DRIVE_FOLDER_ID?: string;
  }
  const Config: NativeConfig;
  export default Config;
}
