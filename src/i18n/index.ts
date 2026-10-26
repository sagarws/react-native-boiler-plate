import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'react-native-localize';
import { storage, StorageKeys } from '@/store/mmkv';
import en from './locales/en.json';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  type LanguageCode,
} from './languages';

export const resources = {
  en: { translation: en },
} as const;

function resolveInitialLanguage(): LanguageCode {
  const persisted = storage.getString(StorageKeys.Language);
  if (persisted && isSupportedLanguage(persisted)) return persisted;

  for (const locale of getLocales()) {
    if (isSupportedLanguage(locale.languageCode)) return locale.languageCode;
  }
  return DEFAULT_LANGUAGE;
}

i18n.use(initReactI18next).init({
  resources,
  lng: resolveInitialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  compatibilityJSON: 'v4',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(code: LanguageCode) {
  storage.set(StorageKeys.Language, code);
  return i18n.changeLanguage(code);
}

export default i18n;
