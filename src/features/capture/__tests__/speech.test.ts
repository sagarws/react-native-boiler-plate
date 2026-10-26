import { storage } from '@/store/mmkv';
import {
  parseSpeechInfo,
  speechService,
  unspeakableScripts,
  VOICE_SAMPLES,
} from '../services/speech.service';
import {
  captureSettingsStore,
  DEFAULT_SPEECH_SETTINGS,
  sanitizeCaptureSettings,
} from '../store/captureSettings.store';

// Built inside the factory: jest.mock is hoisted above the imports.
jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    getSpeechInfo: jest.fn(),
    testVoice: jest.fn(),
    speakText: jest.fn(),
    stopSpeech: jest.fn(),
    openTtsSettings: jest.fn(),
    installVoiceData: jest.fn(),
    isScrollServiceEnabled: jest.fn(),
    openAccessibilitySettings: jest.fn(),
  },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

const DEVICE = JSON.stringify({
  ready: true,
  activeEngine: 'com.google.android.tts',
  defaultEngine: 'com.google.android.tts',
  googleInstalled: true,
  engines: [
    { name: 'com.google.android.tts', label: 'Speech Services by Google' },
  ],
  languages: { en: 'available', hi: 'available', gu: 'missing_data' },
  voices: [
    {
      name: 'hi-in-x-hia-local',
      language: 'hi',
      locale: 'hi-IN',
      networkRequired: false,
      installed: true,
      quality: 400,
    },
    {
      name: 'gu-in-x-guf-network',
      language: 'gu',
      locale: 'gu-IN',
      networkRequired: true,
      installed: false,
      quality: 300,
    },
    { name: 'broken' },
  ],
  scrollServiceEnabled: false,
});

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
});

describe('device capability report', () => {
  it('parses engines, per-language voice data and voices', () => {
    const info = parseSpeechInfo(DEVICE);
    expect(info.ready).toBe(true);
    expect(info.googleInstalled).toBe(true);
    expect(info.languages).toEqual({
      en: 'available',
      hi: 'available',
      gu: 'missing_data',
    });
    expect(info.voices.map(v => v.name)).toEqual([
      'hi-in-x-hia-local',
      'gu-in-x-guf-network',
    ]);
    expect(info.voices[1]).toMatchObject({
      networkRequired: true,
      installed: false,
    });
  });

  it('treats malformed reports as unavailable, never as installed', () => {
    const info = parseSpeechInfo('{"languages":{"gu":"yes"}}');
    expect(info.languages.gu).toBe('not_supported');
    expect(info.ready).toBe(false);
    expect(parseSpeechInfo('not json').ready).toBe(false);
  });

  it('reads it from the native engine', async () => {
    mockNative.getSpeechInfo.mockResolvedValue(DEVICE);
    await expect(speechService.getInfo()).resolves.toMatchObject({
      supported: true,
      ready: true,
    });
  });
});

describe('voice testing and speaking', () => {
  it.each(['en', 'hi', 'gu'] as const)(
    'tests the %s voice with its own sample',
    async language => {
      mockNative.testVoice.mockResolvedValue('ok');
      await expect(speechService.testVoice(language, '', 1, 1)).resolves.toBe(
        'ok',
      );
      expect(mockNative.testVoice).toHaveBeenCalledWith(
        VOICE_SAMPLES[language],
        language,
        '',
        1,
        1,
      );
    },
  );

  it('reports a missing voice instead of substituting another language', async () => {
    mockNative.testVoice.mockResolvedValue('voice_missing');
    await expect(speechService.testVoice('gu', '', 1, 1)).resolves.toBe(
      'voice_missing',
    );
  });

  it('maps unexpected native results and failures to speech_failed', async () => {
    mockNative.speakText.mockResolvedValue('weird');
    await expect(speechService.speak('text')).resolves.toBe('speech_failed');
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockNative.speakText.mockRejectedValue(new Error('x'));
    await expect(speechService.speak('text')).resolves.toBe('speech_failed');
    spy.mockRestore();
  });

  it('does not speak empty text', async () => {
    await expect(speechService.speak('   ')).resolves.toBe('speech_failed');
    expect(mockNative.speakText).not.toHaveBeenCalled();
  });
});

describe('pronunciation warnings', () => {
  const info = parseSpeechInfo(DEVICE);

  it('warns when the OCR scripts include a language with no installed voice', () => {
    expect(unspeakableScripts(['gu', 'en'], info, 'en', true)).toEqual(['gu']);
  });

  it('warns when an English voice would have to read Hindi without switching', () => {
    expect(unspeakableScripts(['hi', 'en'], info, 'en', false)).toEqual(['hi']);
  });

  it('does not warn about English for a Hindi voice, which reads embedded English', () => {
    expect(unspeakableScripts(['hi', 'en'], info, 'hi', false)).toEqual([]);
  });
});

describe('speech and reading settings', () => {
  it('persist across restarts', () => {
    captureSettingsStore.updateSpeech({
      language: 'gu',
      voiceName: 'gu-voice',
      rate: 1.5,
    });
    captureSettingsStore.updateReading({ maxSections: 10, autoScroll: false });
    captureSettingsStore.update({
      action: 'speak_scroll',
      ocrMode: 'gujarati_english',
    });
    captureSettingsStore.resetCacheForTest();
    const s = captureSettingsStore.read();
    expect(s.speech).toMatchObject({
      language: 'gu',
      voiceName: 'gu-voice',
      rate: 1.5,
    });
    expect(s.reading).toMatchObject({ maxSections: 10, autoScroll: false });
    expect(s.action).toBe('speak_scroll');
    expect(s.ocrMode).toBe('gujarati_english');
  });

  it('validate nested values and keep settings saved by older versions working', () => {
    const s = sanitizeCaptureSettings({
      ocrMode: 'mixed',
      action: 'dance',
      speech: { language: 'fr', rate: 9, pitch: 0.1 },
      reading: { maxSections: 0, maxNoNewText: 99 },
    });
    expect(s.ocrMode).toBe('mixed');
    expect(s.action).toBe('copy');
    expect(s.speech).toEqual({
      ...DEFAULT_SPEECH_SETTINGS,
      rate: 2,
      pitch: 0.5,
    });
    expect(s.reading.maxSections).toBe(1);
    expect(s.reading.maxNoNewText).toBe(5);
    // Settings saved before this release have no speech/reading keys.
    expect(sanitizeCaptureSettings({ ocrMode: 'hindi' }).speech).toEqual(
      DEFAULT_SPEECH_SETTINGS,
    );
  });
});
