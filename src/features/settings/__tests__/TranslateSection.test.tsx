import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import { captureSettingsStore } from '@/features/capture/store/captureSettings.store';
import { storage } from '@/store/mmkv';
import { TranslateSection } from '../components/TranslateSection';

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    setGeminiKey: jest.fn(),
    clearGeminiKey: jest.fn(),
    getGeminiKeyStatus: jest.fn(),
    testGeminiKey: jest.fn(),
    listGeminiModels: jest.fn(),
    getSpeechInfo: jest.fn(),
  },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

function find(
  renderer: ReactTestRenderer.ReactTestRenderer,
  id: string,
  prop: string,
) {
  return renderer.root.findAll(
    n => n.props.testID === id && prop in n.props,
  )[0];
}

async function act(fn: () => void) {
  await ReactTestRenderer.act(async () => {
    fn();
  });
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function render() {
  let r: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <TranslateSection expanded onToggle={() => undefined} />,
    );
  });
  mounted.push(r!);
  return r!;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.getGeminiKeyStatus.mockResolvedValue(
    JSON.stringify({ hasKey: false, hint: '' }),
  );
  mockNative.getSpeechInfo.mockResolvedValue(
    JSON.stringify({
      ready: true,
      languages: { en: 'available', hi: 'available', gu: 'missing_data' },
      voices: [],
    }),
  );
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
});

describe('Translation card', () => {
  it('Apply translation is an explicit, persisted switch (off by default)', async () => {
    const r = await render();
    expect(captureSettingsStore.read().translate.enabled).toBe(false);
    await act(() =>
      find(r, 'translate-enabled', 'onValueChange').props.onValueChange(true),
    );
    expect(captureSettingsStore.read().translate.enabled).toBe(true);
    // On without a key: points to the shared Gemini AI settings.
    expect(
      r.root.findAll(n => n.props.testID === 'translate-needs-key').length,
    ).toBeGreaterThan(0);
  });

  it('chooses the target language, warns about a missing voice, edits the prompt', async () => {
    const r = await render();
    await act(() => find(r, 'translate-target-gu', 'onPress').props.onPress());
    expect(captureSettingsStore.read().translate.target).toBe('gu');
    expect(
      r.root.findAll(n => n.props.testID === 'translate-voice-missing').length,
    ).toBeGreaterThan(0);
    await act(() =>
      find(r, 'translate-prompt', 'onChangeText').props.onChangeText(
        'Into {target}, casual.',
      ),
    );
    expect(captureSettingsStore.read().translate.prompt).toBe(
      'Into {target}, casual.',
    );
    await act(() =>
      find(r, 'translate-reset-prompt', 'onPress').props.onPress(),
    );
    expect(captureSettingsStore.read().translate.prompt).toMatch(
      /^Translate the text naturally/,
    );
  });
});
