import { storage } from '@/store/mmkv';
import { FLOATING_ACTIONS } from '../capture.types';
import { buildNativeConfig } from '../services/screenOcr.service';
import {
  looksLikeApiKey,
  parseKeyStatus,
  translateService,
} from '../services/translate.service';
import {
  captureSettingsStore,
  DEFAULT_CAPTURE_SETTINGS,
  DEFAULT_TRANSLATE_SETTINGS,
  MAX_TRANSLATE_PROMPT,
  sanitizeCaptureSettings,
} from '../store/captureSettings.store';
import { parseOcrResult } from '../utils/parseResult';

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    setGeminiKey: jest.fn(),
    clearGeminiKey: jest.fn(),
    getGeminiKeyStatus: jest.fn(),
    testGeminiKey: jest.fn(),
  },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

const FAKE_KEY = 'AIzaSyFakeKeyForTests0123456789';

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
});

describe('fifth action', () => {
  it('adds Speak with translation after the existing four, unchanged', () => {
    expect(FLOATING_ACTIONS).toEqual([
      'copy',
      'speak',
      'speak_scroll',
      'speak_pagination',
      'speak_translate',
    ]);
  });

  it('persists translation settings, and consent is off by default', () => {
    expect(captureSettingsStore.read().translate.consent).toBe(false);
    captureSettingsStore.update({ action: 'speak_translate' });
    captureSettingsStore.updateTranslate({
      consent: true,
      target: 'gu',
      source: 'en',
      prompt: 'Formal {target}',
    });
    captureSettingsStore.resetCacheForTest();
    const s = captureSettingsStore.read();
    expect(s.action).toBe('speak_translate');
    expect(s.translate).toEqual({
      ...DEFAULT_TRANSLATE_SETTINGS,
      consent: true,
      target: 'gu',
      source: 'en',
      prompt: 'Formal {target}',
    });
  });

  it('validates translation settings field by field', () => {
    const s = sanitizeCaptureSettings({
      translate: {
        consent: 'yes',
        target: 'fr',
        source: 'xx',
        prompt: 'x'.repeat(5000),
        model: 'bad model!',
      },
    });
    expect(s.translate.consent).toBe(false);
    expect(s.translate.target).toBe('hi');
    expect(s.translate.source).toBe('auto');
    expect(s.translate.prompt).toHaveLength(MAX_TRANSLATE_PROMPT);
    expect(s.translate.model).toBe('gemini-2.5-flash');
    expect(
      sanitizeCaptureSettings({ translate: { prompt: '   ' } }).translate
        .prompt,
    ).toBe(DEFAULT_TRANSLATE_SETTINGS.prompt);
  });

  it('sends translation settings — but never a key — to native', () => {
    const config = buildNativeConfig(
      {
        ...DEFAULT_CAPTURE_SETTINGS,
        translate: { ...DEFAULT_TRANSLATE_SETTINGS, consent: true },
      },
      { background: '#000', icon: '#fff', panel: '#000', panelText: '#fff' },
    );
    expect(config.translate.consent).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/apiKey|AIza/);
  });
});

describe('Gemini key handling', () => {
  it('JS only ever learns whether a key exists and its last four characters', async () => {
    mockNative.getGeminiKeyStatus.mockResolvedValue(
      JSON.stringify({ hasKey: true, hint: '6789' }),
    );
    await expect(translateService.getKeyStatus()).resolves.toEqual({
      hasKey: true,
      hint: '6789',
    });
    expect(parseKeyStatus('{oops')).toEqual({ hasKey: false, hint: '' });
    expect(
      parseKeyStatus(JSON.stringify({ hasKey: true, hint: FAKE_KEY })).hint,
    ).toBe('6789');
  });

  it('rejects implausible keys without calling native', async () => {
    expect(looksLikeApiKey('short')).toBe(false);
    expect(looksLikeApiKey('has a space in it 0123456789')).toBe(false);
    expect(looksLikeApiKey(FAKE_KEY)).toBe(true);
    await expect(translateService.saveKey('short')).resolves.toBe(false);
    expect(mockNative.setGeminiKey).not.toHaveBeenCalled();
  });

  it('hands a trimmed key to native storage once', async () => {
    mockNative.setGeminiKey.mockResolvedValue(true);
    await expect(translateService.saveKey(`  ${FAKE_KEY}  `)).resolves.toBe(
      true,
    );
    expect(mockNative.setGeminiKey).toHaveBeenCalledWith(FAKE_KEY);
  });

  it('never logs a failure that could contain the key', async () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockNative.setGeminiKey.mockRejectedValue(
      new Error(`failed for ${FAKE_KEY}`),
    );
    await expect(translateService.saveKey(FAKE_KEY)).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('maps test outcomes and treats unknown answers as bad responses', async () => {
    mockNative.testGeminiKey.mockResolvedValue('invalid_key');
    await expect(translateService.test()).resolves.toBe('invalid_key');
    mockNative.testGeminiKey.mockResolvedValue('weird');
    await expect(translateService.test()).resolves.toBe('bad_response');
  });
});

describe('translated results', () => {
  it('keeps the translation and its languages from the native result', () => {
    const r = parseOcrResult({
      id: '1',
      text: 'Your order has shipped.',
      mode: 'english',
      translation: 'आपका ऑर्डर भेज दिया गया है।',
      targetLanguage: 'hi',
      sourceLanguage: 'en',
    });
    expect(r).toMatchObject({
      translation: 'आपका ऑर्डर भेज दिया गया है।',
      targetLanguage: 'hi',
      sourceLanguage: 'en',
    });
    expect(
      parseOcrResult({ id: '2', text: 'x', mode: 'english' })?.translation,
    ).toBeUndefined();
  });
});
