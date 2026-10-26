import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV({ id: 'app.default' });

/** Every MMKV key the app uses, in one place so two features can't collide. */
export const StorageKeys = {
  Language: 'app.language',
  Session: 'session.user',
  ThemePreference: 'app.themePreference',
  ApiBaseUrlOverride: 'app.apiBaseUrlOverride',
} as const;
