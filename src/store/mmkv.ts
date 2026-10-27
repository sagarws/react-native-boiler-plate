import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV({ id: 'app.default' });

/** Every MMKV key the app uses, in one place so two features can't collide. */
export const StorageKeys = {
  Language: 'app.language',
  Session: 'session.user',
  ThemePreference: 'app.themePreference',
  ThemePreset: 'app.themePreset',
  TypographyPreset: 'app.typographyPreset',
  ApiBaseUrlOverride: 'app.apiBaseUrlOverride',
  CaptureSettings: 'capture.settings',
  CaptureHistory: 'capture.history',
  OnboardingComplete: 'app.onboardingComplete',
  /** File Management: the "Akshar" folder id in each connected Google account's Drive. */
  DriveRootFolders: 'files.driveRootFolders',
} as const;
