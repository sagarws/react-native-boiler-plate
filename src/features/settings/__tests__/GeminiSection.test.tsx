import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import '@/i18n';
import { captureSettingsStore } from '@/features/capture/store/captureSettings.store';
import { storage } from '@/store/mmkv';
import { GeminiSection } from '../components/GeminiSection';

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
      <GeminiSection expanded onToggle={() => undefined} />,
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

describe('Gemini AI card (shared by Refine text and Translation)', () => {
  it('saves the key to native storage and clears it from the input right away', async () => {
    mockNative.setGeminiKey.mockResolvedValue(true);
    const r = await render();
    await act(() =>
      find(r, 'gemini-key-input', 'onChangeText').props.onChangeText(KEY),
    );
    mockNative.getGeminiKeyStatus.mockResolvedValue(
      JSON.stringify({ hasKey: true, hint: '6789' }),
    );
    await act(() => find(r, 'gemini-save-key', 'onPress').props.onPress());
    expect(mockNative.setGeminiKey).toHaveBeenCalledWith(KEY);
    expect(find(r, 'gemini-key-input', 'value').props.value).toBe('');
    expect(textsOf(r.root)).toContain('Saved key ending in …6789');
    expect(JSON.stringify(r.toJSON())).not.toContain(KEY);
    expect(
      find(r, 'gemini-key-input', 'secureTextEntry').props.secureTextEntry,
    ).toBe(true);
  });

  it('Test connection lists models and shows Google’s exact error', async () => {
    mockNative.getGeminiKeyStatus.mockResolvedValue(
      JSON.stringify({ hasKey: true, hint: '6789' }),
    );
    mockNative.listGeminiModels.mockResolvedValue(
      JSON.stringify({
        outcome: 'ok',
        models: [
          { id: 'gemini-flash-latest', displayName: 'Gemini Flash Latest' },
          { id: 'gemini-3-flash', displayName: 'Gemini 3 Flash' },
        ],
      }),
    );
    mockNative.testGeminiKey.mockResolvedValue(
      JSON.stringify({
        outcome: 'model_not_found',
        status: 404,
        detail: 'models/gemini-2.5-flash is not found',
      }),
    );
    const r = await render();
    await act(() => find(r, 'gemini-test', 'onPress').props.onPress());
    const result = find(r, 'gemini-test-result', 'message');
    expect(result.props.message).toContain(
      'This model isn’t available for your key.',
    );
    expect(result.props.message).toContain(
      'Google says (HTTP 404): models/gemini-2.5-flash is not found',
    );

    // Pick a listed model.
    await act(() =>
      find(r, 'gemini-models-gemini-3-flash', 'onPress').props.onPress(),
    );
    expect(captureSettingsStore.read().translate.model).toBe('gemini-3-flash');
  });

  it('sets the thinking level', async () => {
    const r = await render();
    await act(() => find(r, 'gemini-thinking-high', 'onPress').props.onPress());
    expect(captureSettingsStore.read().translate.thinkingLevel).toBe('high');
  });

  it('saves a valid project number and rejects anything else', async () => {
    const r = await render();
    expect(find(r, 'gemini-project', 'value').props.value).toBe('49677894119');
    await act(() => find(r, 'gemini-project-save', 'onPress').props.onPress());
    expect(captureSettingsStore.read().translate.projectNumber).toBe(
      '49677894119',
    );
    await act(() =>
      find(r, 'gemini-project', 'onChangeText').props.onChangeText('12'),
    );
    await act(() => find(r, 'gemini-project-save', 'onPress').props.onPress());
    expect(find(r, 'gemini-project-message', 'message').props.message).toBe(
      'A project number has digits only.',
    );
    expect(captureSettingsStore.read().translate.projectNumber).toBe(
      '49677894119',
    );
  });
});
