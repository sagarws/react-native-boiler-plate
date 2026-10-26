// Add a locale by dropping a JSON file next to en.json, registering it in
// `resources` in ./index.ts, and adding a row here.
export const SUPPORTED_LANGUAGES = [{ code: 'en', label: 'English', flag: '🇬🇧' }] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function isSupportedLanguage(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some(l => l.code === code);
}
