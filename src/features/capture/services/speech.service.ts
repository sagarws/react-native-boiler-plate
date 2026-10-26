import NativeScreenOcr from '@/specs/NativeScreenOcr';
import { logger } from '@/shared/utils';
import {
  isSpeechLanguage,
  SPEECH_LANGUAGES,
  type LanguageStatus,
  type SpeechInfo,
  type SpeechLanguage,
  type SpeechOutcome,
  type VoiceInfo,
} from '../capture.types';

export const GOOGLE_TTS = 'com.google.android.tts';

/** Test Voice samples, one per speech language. */
export const VOICE_SAMPLES: Record<SpeechLanguage, string> = {
  en: 'Hello! Your screen text is ready to read.',
  hi: 'नमस्ते! आपका स्क्रीन टेक्स्ट पढ़ने के लिए तैयार है।',
  gu: 'નમસ્તે! તમારી સ્ક્રીનનો ટેક્સ્ટ વાંચવા માટે તૈયાર છે.',
};

const UNSUPPORTED_INFO: SpeechInfo = {
  supported: false,
  ready: false,
  activeEngine: '',
  defaultEngine: '',
  googleInstalled: false,
  engines: [],
  languages: { en: 'not_supported', hi: 'not_supported', gu: 'not_supported' },
  voices: [],
  scrollServiceEnabled: false,
};

function isLanguageStatus(value: unknown): value is LanguageStatus {
  return (
    value === 'available' ||
    value === 'missing_data' ||
    value === 'not_supported'
  );
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Validates the native capability report; anything malformed reads as unavailable. */
export function parseSpeechInfo(json: string): SpeechInfo {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ...UNSUPPORTED_INFO, supported: true };
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const langs = (
    r.languages && typeof r.languages === 'object' ? r.languages : {}
  ) as Record<string, unknown>;
  const languages = Object.fromEntries(
    SPEECH_LANGUAGES.map(l => [
      l,
      isLanguageStatus(langs[l]) ? langs[l] : 'not_supported',
    ]),
  ) as Record<SpeechLanguage, LanguageStatus>;
  const voices: VoiceInfo[] = Array.isArray(r.voices)
    ? r.voices.flatMap(v => {
        const o = (v && typeof v === 'object' ? v : {}) as Record<
          string,
          unknown
        >;
        if (!str(o.name) || !isSpeechLanguage(o.language)) return [];
        return [
          {
            name: str(o.name),
            language: str(o.language),
            locale: str(o.locale),
            networkRequired: o.networkRequired === true,
            installed: o.installed !== false,
            quality: typeof o.quality === 'number' ? o.quality : 0,
          },
        ];
      })
    : [];
  const engines = Array.isArray(r.engines)
    ? r.engines.flatMap(e => {
        const o = (e && typeof e === 'object' ? e : {}) as Record<
          string,
          unknown
        >;
        return str(o.name)
          ? [{ name: str(o.name), label: str(o.label) || str(o.name) }]
          : [];
      })
    : [];
  return {
    supported: true,
    ready: r.ready === true,
    activeEngine: str(r.activeEngine),
    defaultEngine: str(r.defaultEngine),
    googleInstalled: r.googleInstalled === true,
    engines,
    languages,
    voices,
    scrollServiceEnabled: r.scrollServiceEnabled === true,
  };
}

/** Human label for an engine package, from the engine list when known. */
export function engineLabel(info: SpeechInfo, pkg: string): string {
  return info.engines.find(e => e.name === pkg)?.label ?? pkg;
}

function outcome(value: string): SpeechOutcome {
  return value === 'ok' || value === 'voice_missing' || value === 'not_ready'
    ? value
    : 'speech_failed';
}

/** Android text-to-speech through the native module; safe no-ops without it. */
export const speechService = {
  async getInfo(): Promise<SpeechInfo> {
    if (!NativeScreenOcr) return UNSUPPORTED_INFO;
    try {
      return parseSpeechInfo(await NativeScreenOcr.getSpeechInfo());
    } catch (error) {
      logger.error('speech.getInfo failed', error);
      return { ...UNSUPPORTED_INFO, supported: true };
    }
  },

  openTtsSettings(): void {
    NativeScreenOcr?.openTtsSettings();
  },

  installVoiceData(): void {
    NativeScreenOcr?.installVoiceData();
  },

  async testVoice(
    language: SpeechLanguage,
    voiceName: string,
    rate: number,
    pitch: number,
  ): Promise<SpeechOutcome> {
    if (!NativeScreenOcr) return 'unsupported';
    try {
      return outcome(
        await NativeScreenOcr.testVoice(
          VOICE_SAMPLES[language],
          language,
          voiceName,
          rate,
          pitch,
        ),
      );
    } catch (error) {
      logger.error('speech.testVoice failed', error);
      return 'speech_failed';
    }
  },

  /** Reads text with the saved speech settings; resolves when speech ends. */
  async speak(text: string): Promise<SpeechOutcome> {
    if (!NativeScreenOcr) return 'unsupported';
    if (text.trim().length === 0) return 'speech_failed';
    try {
      return outcome(await NativeScreenOcr.speakText(text));
    } catch (error) {
      logger.error('speech.speak failed', error);
      return 'speech_failed';
    }
  },

  stop(): void {
    NativeScreenOcr?.stopSpeech();
  },

  async isScrollServiceEnabled(): Promise<boolean> {
    if (!NativeScreenOcr) return false;
    try {
      return await NativeScreenOcr.isScrollServiceEnabled();
    } catch (error) {
      logger.error('speech.isScrollServiceEnabled failed', error);
      return false;
    }
  },

  openAccessibilitySettings(): void {
    NativeScreenOcr?.openAccessibilitySettings();
  },
};

/**
 * Speech languages the extracted scripts need but the device cannot speak —
 * the basis of the "this voice can't pronounce…" warning.
 */
export function unspeakableScripts(
  scripts: readonly SpeechLanguage[],
  info: SpeechInfo,
  primary: SpeechLanguage,
  switchByScript: boolean,
): SpeechLanguage[] {
  if (!info.supported || !info.ready) return [];
  const usable = (l: SpeechLanguage) => info.languages[l] === 'available';
  return scripts.filter(script => {
    if (script === primary) return !usable(primary);
    // Hindi/Gujarati voices read embedded English, but not the other way round.
    if (script === 'en' && primary !== 'en' && usable(primary)) return false;
    return !(switchByScript && usable(script));
  });
}
