import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import {
  captureSettingsStore,
  DEFAULT_REFINE_PROMPT,
  sanitizeCaptureSettings,
} from '@/features/capture/store/captureSettings.store';
import { buildNativeConfig } from '@/features/capture/services/screenOcr.service';
import { storage } from '@/store/mmkv';
import { RefineSection } from '../components/RefineSection';

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: { getGeminiKeyStatus: jest.fn() },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function render() {
  let r: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <RefineSection expanded onToggle={() => undefined} />,
    );
  });
  mounted.push(r!);
  return r!;
}

function find(
  r: ReactTestRenderer.ReactTestRenderer,
  id: string,
  prop: string,
) {
  return r.root.findAll(n => n.props.testID === id && prop in n.props)[0];
}

async function act(fn: () => void) {
  await ReactTestRenderer.act(async () => {
    fn();
  });
}

beforeEach(() => {
  mockNative.getGeminiKeyStatus.mockResolvedValue(
    JSON.stringify({ hasKey: false, hint: '' }),
  );
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
});

describe('Refine text card', () => {
  it('is off by default and persists the switch', async () => {
    const r = await render();
    expect(captureSettingsStore.read().refine.enabled).toBe(false);
    await act(() =>
      find(r, 'refine-enabled', 'onValueChange').props.onValueChange(true),
    );
    expect(captureSettingsStore.read().refine.enabled).toBe(true);
    // On without a key: points to the shared key in the Translation card.
    expect(
      r.root.findAll(n => n.props.testID === 'refine-needs-key').length,
    ).toBeGreaterThan(0);
  });

  it('edits and resets the refining prompt', async () => {
    const r = await render();
    await act(() =>
      find(r, 'refine-prompt', 'onChangeText').props.onChangeText(
        'Fix old Gujarati book OCR.',
      ),
    );
    expect(captureSettingsStore.read().refine.prompt).toBe(
      'Fix old Gujarati book OCR.',
    );
    await act(() => find(r, 'refine-reset-prompt', 'onPress').props.onPress());
    expect(captureSettingsStore.read().refine.prompt).toBe(
      DEFAULT_REFINE_PROMPT,
    );
  });
});

describe('refine settings', () => {
  it('validate field by field and default the prompt', () => {
    expect(
      sanitizeCaptureSettings({ refine: { enabled: 'yes', prompt: '  ' } })
        .refine,
    ).toEqual({
      enabled: false,
      prompt: DEFAULT_REFINE_PROMPT,
    });
    expect(
      sanitizeCaptureSettings({ refine: { prompt: 'x'.repeat(3000) } }).refine
        .prompt,
    ).toHaveLength(1000);
  });

  it('reach the native service', () => {
    const settings = sanitizeCaptureSettings({
      refine: { enabled: true, prompt: 'Fix it.' },
    });
    const config = buildNativeConfig(settings, {
      background: '#000',
      icon: '#fff',
      panel: '#000',
      panelText: '#fff',
    });
    expect(config.refine).toEqual({ enabled: true, prompt: 'Fix it.' });
  });
});
