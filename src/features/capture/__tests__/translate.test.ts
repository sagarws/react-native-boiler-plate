import { storage } from '@/store/mmkv';
import { FLOATING_ACTIONS } from '../capture.types';
import { buildNativeConfig } from '../services/screenOcr.service';
import {
  looksLikeApiKey,
  parseKeyStatus,
  parseModels,
  parseReport,
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
    listGeminiModels: jest.fn(),
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

describe('translation is a switch, not an action', () => {
  it('keeps exactly the four tap actions', () => {
    expect(FLOATING_ACTIONS).toEqual([
      'copy',
      'speak',
      'speak_scroll',
      'speak_pagination',
    ]);
  });

  it('defaults: off, Hindi, auto-detect, gemini-flash-latest, low thinking', () => {
    expect(DEFAULT_TRANSLATE_SETTINGS).toMatchObject({
      enabled: false,
      target: 'hi',
      source: 'auto',
      model: 'gemini-flash-latest',
      thinkingLevel: 'low',
      projectNumber: '',
    });
  });

  it('migrates the short-lived fifth action and the old consent flag', () => {
    const migrated = sanitizeCaptureSettings({
      action: 'speak_translate',
      translate: { target: 'gu' },
    });
    expect(migrated.action).toBe('speak');
    expect(migrated.translate.enabled).toBe(true);
    expect(migrated.translate.target).toBe('gu');
    expect(
      sanitizeCaptureSettings({ translate: { consent: true } }).translate
        .enabled,
    ).toBe(true);
  });

  it('persists every translation setting across restarts', () => {
    captureSettingsStore.updateTranslate({
      enabled: true,
      target: 'en',
      source: 'gu',
      prompt: 'Formal {target}',
      model: 'gemini-3-flash',
      thinkingLevel: 'medium',
      projectNumber: '49677894119',
    });
    captureSettingsStore.resetCacheForTest();
    expect(captureSettingsStore.read().translate).toEqual({
      enabled: true,
      target: 'en',
      source: 'gu',
      prompt: 'Formal {target}',
      model: 'gemini-3-flash',
      thinkingLevel: 'medium',
      projectNumber: '49677894119',
    });
  });

  it('validates field by field', () => {
    const s = sanitizeCaptureSettings({
      translate: {
        enabled: 'yes',
        target: 'fr',
        source: 'xx',
        prompt: 'x'.repeat(5000),
        model: 'bad model!',
        thinkingLevel: 'max',
        projectNumber: 'proj-1',
      },
    });
    expect(s.translate).toMatchObject({
      enabled: false,
      target: 'hi',
      source: 'auto',
      model: 'gemini-flash-latest',
      thinkingLevel: 'low',
      projectNumber: '',
    });
    expect(s.translate.prompt).toHaveLength(MAX_TRANSLATE_PROMPT);
  });

  it('sends translation settings — never a key — to native', () => {
    const config = buildNativeConfig(
      {
        ...DEFAULT_CAPTURE_SETTINGS,
        translate: { ...DEFAULT_TRANSLATE_SETTINGS, enabled: true },
      },
      { background: '#000', icon: '#fff', panel: '#000', panelText: '#fff' },
    );
    expect(config.translate).toMatchObject({
      enabled: true,
      model: 'gemini-flash-latest',
      thinkingLevel: 'low',
    });
    expect(JSON.stringify(config)).not.toMatch(/apiKey|AIza/);
  });
});

describe('Gemini key handling', () => {
  it('JS only learns whether a key exists and its last four characters', async () => {
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

  it('hands a trimmed key to native once and never logs failures', async () => {
    mockNative.setGeminiKey.mockResolvedValue(true);
    await expect(translateService.saveKey(`  ${FAKE_KEY}  `)).resolves.toBe(
      true,
    );
    expect(mockNative.setGeminiKey).toHaveBeenCalledWith(FAKE_KEY);
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
});

describe('connection test reports', () => {
  it("passes Google's own error through, so a bad model is diagnosable", async () => {
    mockNative.testGeminiKey.mockResolvedValue(
      JSON.stringify({
        outcome: 'model_not_found',
        status: 404,
        detail: 'models/gemini-2.5-flash is not found',
      }),
    );
    await expect(translateService.test()).resolves.toEqual({
      outcome: 'model_not_found',
      status: 404,
      detail: 'models/gemini-2.5-flash is not found',
    });
  });

  it('treats unknown or malformed reports as unexpected answers', () => {
    expect(parseReport(JSON.stringify({ outcome: 'weird' })).outcome).toBe(
      'bad_response',
    );
    expect(parseReport('not json')).toEqual({
      outcome: 'bad_response',
      status: 0,
      detail: '',
    });
  });

  it('lists the models the key can use', async () => {
    mockNative.listGeminiModels.mockResolvedValue(
      JSON.stringify({
        outcome: 'ok',
        models: [
          { id: 'gemini-flash-latest', displayName: 'Gemini Flash Latest' },
          { id: 'gemini-3-flash', displayName: 'Gemini 3 Flash' },
          { id: 'bad id!', displayName: 'x' },
        ],
      }),
    );
    const { report, models } = await translateService.listModels();
    expect(report.outcome).toBe('ok');
    expect(models.map(m => m.id)).toEqual([
      'gemini-flash-latest',
      'gemini-3-flash',
    ]);
    expect(parseModels('{}')).toEqual([]);
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
