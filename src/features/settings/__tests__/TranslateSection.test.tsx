import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
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
    getSpeechInfo: jest.fn(),
  },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

const KEY = 'AIzaSyFakeKeyForTests0123456789';

function textsOf(root: ReactTestInstance): string[] {
  return root
    .findAllByType('Text' as never, { deep: true })
    .flatMap(node => node.children)
    .filter((child): child is string => typeof child === 'string');
}

function find(
  renderer: ReactTestRenderer.ReactTestRenderer,
  id: string,
  prop: string,
) {
  return renderer.root.findAll(
    n => n.props.testID === id && prop in n.props,
  )[0];
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

describe('Translate & speak settings', () => {
  it('requires explicit consent before anything can be sent', async () => {
    const r = await render();
    expect(captureSettingsStore.read().translate.consent).toBe(false);
    await ReactTestRenderer.act(async () => {
      find(r, 'translate-consent', 'onValueChange').props.onValueChange(true);
    });
    expect(captureSettingsStore.read().translate.consent).toBe(true);
  });

  it('saves the key to native storage and clears it from the input right away', async () => {
    mockNative.setGeminiKey.mockResolvedValue(true);
    const r = await render();
    await ReactTestRenderer.act(async () => {
      find(r, 'translate-key-input', 'onChangeText').props.onChangeText(KEY);
    });
    mockNative.getGeminiKeyStatus.mockResolvedValue(
      JSON.stringify({ hasKey: true, hint: '6789' }),
    );
    await ReactTestRenderer.act(async () => {
      find(r, 'translate-save-key', 'onPress').props.onPress();
    });
    expect(mockNative.setGeminiKey).toHaveBeenCalledWith(KEY);
    expect(find(r, 'translate-key-input', 'value').props.value).toBe('');
    expect(textsOf(r.root)).toContain('Saved key ending in …6789');
    // The full key is not rendered anywhere.
    expect(JSON.stringify(r.toJSON())).not.toContain(KEY);
  });

  it('masks the key input by default', async () => {
    const r = await render();
    expect(
      find(r, 'translate-key-input', 'secureTextEntry').props.secureTextEntry,
    ).toBe(true);
  });

  it('reports the connection test result', async () => {
    mockNative.getGeminiKeyStatus.mockResolvedValue(
      JSON.stringify({ hasKey: true, hint: '6789' }),
    );
    mockNative.testGeminiKey.mockResolvedValue('api_disabled');
    const r = await render();
    await ReactTestRenderer.act(async () => {
      find(r, 'translate-test', 'onPress').props.onPress();
    });
    expect(textsOf(r.root)).toContain(
      'The Generative Language API isn’t enabled for this key’s Google Cloud project.',
    );
  });

  it('chooses the target language and warns when its voice is missing', async () => {
    const r = await render();
    await ReactTestRenderer.act(async () => {
      find(r, 'translate-target-gu', 'onPress').props.onPress();
    });
    expect(captureSettingsStore.read().translate.target).toBe('gu');
    expect(
      r.root.findAll(n => n.props.testID === 'translate-voice-missing').length,
    ).toBeGreaterThan(0);
  });

  it('edits and resets the translation instructions', async () => {
    const r = await render();
    await ReactTestRenderer.act(async () => {
      find(r, 'translate-prompt', 'onChangeText').props.onChangeText(
        'Translate into {target}, casual tone.',
      );
    });
    expect(captureSettingsStore.read().translate.prompt).toBe(
      'Translate into {target}, casual tone.',
    );
    await ReactTestRenderer.act(async () => {
      find(r, 'translate-reset-prompt', 'onPress').props.onPress();
    });
    expect(captureSettingsStore.read().translate.prompt).toMatch(
      /^Translate the text naturally/,
    );
  });
});
