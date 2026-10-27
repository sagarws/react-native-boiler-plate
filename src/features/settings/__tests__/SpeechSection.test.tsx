import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import { captureSettingsStore } from '@/features/capture/store/captureSettings.store';
import {
  savedVoiceStatus,
  voicesFor,
  parseSpeechInfo,
} from '@/features/capture/services/speech.service';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { SpeechSection } from '../components/SpeechSection';

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    getSpeechInfo: jest.fn(),
    previewVoice: jest.fn(),
    testVoice: jest.fn(),
    stopSpeech: jest.fn(),
    openTtsSettings: jest.fn(),
    installVoiceData: jest.fn(),
  },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

/** What the device's engine reports: Hindi + English voices, Gujarati data missing, and a French voice. */
const DEVICE = {
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
      name: 'en-in-x-ena-local',
      language: 'en',
      locale: 'en-IN',
      networkRequired: false,
      installed: true,
      quality: 400,
    },
    {
      name: 'en-us-x-iol-network',
      language: 'en',
      locale: 'en-US',
      networkRequired: true,
      installed: true,
      quality: 300,
    },
    {
      name: 'hi-in-x-hia-local',
      language: 'hi',
      locale: 'hi-IN',
      networkRequired: false,
      installed: true,
      quality: 400,
    },
    {
      name: 'fr-fr-x-frc-local',
      language: 'fr',
      locale: 'fr-FR',
      networkRequired: false,
      installed: true,
      quality: 400,
    },
  ],
  scrollServiceEnabled: false,
};

function textsOf(root: ReactTestInstance): string[] {
  return root
    .findAllByType('Text' as never, { deep: true })
    .flatMap(node => node.children)
    .filter((child): child is string => typeof child === 'string');
}

function byId(renderer: ReactTestRenderer.ReactTestRenderer, id: string) {
  return renderer.root.findAll(
    n => n.props.testID === id && typeof n.props.onPress === 'function',
  )[0];
}

async function press(
  renderer: ReactTestRenderer.ReactTestRenderer,
  id: string,
) {
  const node = byId(renderer, id);
  if (!node) throw new Error(`no pressable ${id}`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function render(expanded = true) {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SpeechSection expanded={expanded} onToggle={() => undefined} />,
    );
  });
  mounted.push(renderer!);
  return renderer!;
}

/** A preview whose completion the test controls. */
function deferredPreview() {
  let resolve: (value: string) => void = () => undefined;
  mockNative.previewVoice.mockImplementationOnce(
    () => new Promise<string>(r => (resolve = r)),
  );
  return (value: string) => resolve(value);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.getSpeechInfo.mockResolvedValue(JSON.stringify(DEVICE));
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
});

describe('voice grouping', () => {
  it('groups by language and ignores languages other than English, Gujarati, Hindi', () => {
    const info = parseSpeechInfo(JSON.stringify(DEVICE));
    expect(voicesFor(info, 'en').map(v => v.name)).toEqual([
      'en-in-x-ena-local',
      'en-us-x-iol-network',
    ]);
    expect(voicesFor(info, 'hi').map(v => v.name)).toEqual([
      'hi-in-x-hia-local',
    ]);
    expect(voicesFor(info, 'gu')).toEqual([]);
    expect(info.voices.some(v => v.language === 'fr')).toBe(false);
  });

  it('flags a saved voice that is no longer on the device', () => {
    const info = parseSpeechInfo(JSON.stringify(DEVICE));
    const base = captureSettingsStore.read().speech;
    expect(savedVoiceStatus(info, { ...base, voiceName: '' })).toBe('default');
    expect(
      savedVoiceStatus(info, { ...base, voiceName: 'en-in-x-ena-local' }),
    ).toBe('available');
    expect(savedVoiceStatus(info, { ...base, voiceName: 'en-gb-x-gone' })).toBe(
      'unavailable',
    );
  });
});

describe('language-first voice picker', () => {
  it('shows exactly English, Gujarati and Hindi, in that order', async () => {
    const renderer = await render();
    const languages = renderer.root
      .findAll(
        n =>
          typeof n.props.testID === 'string' &&
          /^voice-language-[a-z]+$/.test(n.props.testID),
      )
      .map(n => n.props.testID);
    expect([...new Set(languages)]).toEqual([
      'voice-language-en',
      'voice-language-gu',
      'voice-language-hi',
    ]);
    const texts = textsOf(renderer.root);
    expect(texts).toContain('ગુજરાતી · Gujarati');
    expect(texts).toContain('हिन्दी · Hindi');
    expect(texts.join(' ')).not.toMatch(/fr-fr|French/);
  });

  it('expands one language at a time to its real voices', async () => {
    const renderer = await render();
    // The language in use starts open.
    expect(byId(renderer, 'voice-en-in-x-ena-local')).toBeTruthy();
    await press(renderer, 'voice-language-hi-header');
    expect(byId(renderer, 'voice-hi-in-x-hia-local')).toBeTruthy();
    expect(byId(renderer, 'voice-en-in-x-ena-local')).toBeUndefined();
    // Tapping again collapses it.
    await press(renderer, 'voice-language-hi-header');
    expect(byId(renderer, 'voice-hi-in-x-hia-local')).toBeUndefined();
  });

  it('explains how to install a missing language instead of inventing voices', async () => {
    const renderer = await render();
    await press(renderer, 'voice-language-gu-header');
    expect(
      renderer.root.findAll(n => n.props.testID === 'voice-gu-empty').length,
    ).toBeGreaterThan(0);
    expect(textsOf(renderer.root)).toContain(
      'Your text-to-speech engine has no Gujarati voice on this phone.',
    );
  });

  it('labels offline and network voices', async () => {
    const renderer = await render();
    const texts = textsOf(renderer.root);
    expect(texts).toContain('en-IN · Offline');
    expect(texts).toContain('en-US · Needs internet');
  });

  it('selecting a voice saves it without playing it', async () => {
    const renderer = await render();
    await press(renderer, 'voice-language-hi-header');
    await press(renderer, 'voice-hi-in-x-hia-local');
    expect(captureSettingsStore.read().speech).toMatchObject({
      language: 'hi',
      voiceName: 'hi-in-x-hia-local',
    });
    expect(mockNative.previewVoice).not.toHaveBeenCalled();
    expect(mockNative.testVoice).not.toHaveBeenCalled();
  });

  it('playing a voice previews it with its own sample and does not select it', async () => {
    mockNative.previewVoice.mockResolvedValue('ok');
    const renderer = await render();
    await press(renderer, 'voice-en-us-x-iol-network-play');
    expect(mockNative.previewVoice).toHaveBeenCalledWith(
      'Hello! This is a preview of the selected voice.',
      'en',
      'en-us-x-iol-network',
      1,
      1,
    );
    expect(captureSettingsStore.read().speech.voiceName).toBe('');
  });

  it('plays one preview at a time; the replaced one cannot reset the new one', async () => {
    const finishFirst = deferredPreview();
    deferredPreview();
    const renderer = await render();
    await press(renderer, 'voice-en-in-x-ena-local-play');
    await press(renderer, 'voice-en-us-x-iol-network-play');
    // The first request now resolves late as 'stopped'.
    await ReactTestRenderer.act(async () => {
      finishFirst('stopped');
    });
    const playButton = byId(renderer, 'voice-en-us-x-iol-network-play');
    expect(playButton.props.accessibilityLabel).toBe('Stop the sample');
  });

  it('Stop ends the preview through the engine', async () => {
    const finish = deferredPreview();
    const renderer = await render();
    await press(renderer, 'voice-en-in-x-ena-local-play');
    await press(renderer, 'voice-en-in-x-ena-local-play');
    expect(mockNative.stopSpeech).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => {
      finish('stopped');
    });
    expect(
      byId(renderer, 'voice-en-in-x-ena-local-play').props.accessibilityLabel,
    ).toMatch(/^Play a sample/);
  });

  it('refuses to preview over an active reading session', async () => {
    mockNative.previewVoice.mockResolvedValue('busy');
    const renderer = await render();
    await press(renderer, 'voice-en-in-x-ena-local-play');
    expect(textsOf(renderer.root)).toContain(
      'A reading session is speaking. Pause or stop it before previewing voices.',
    );
  });

  it('warns when the saved voice disappeared from the device', async () => {
    captureSettingsStore.updateSpeech({
      language: 'en',
      voiceName: 'en-gb-x-gone',
    });
    const renderer = await render();
    expect(
      renderer.root.findAll(
        n => n.props.testID === 'speech-saved-voice-unavailable',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('stops a playing preview when the card is collapsed', async () => {
    deferredPreview();
    const renderer = await render();
    await press(renderer, 'voice-en-in-x-ena-local-play');
    await ReactTestRenderer.act(async () => {
      renderer.update(
        <SpeechSection expanded={false} onToggle={() => undefined} />,
      );
    });
    expect(mockNative.stopSpeech).toHaveBeenCalled();
  });

  it('collapses to a summary of the language and voice in use', async () => {
    const renderer = await render(false);
    expect(textsOf(renderer.root)).toContain(
      'English · default voice · 2 voices',
    );
    expect(byId(renderer, 'voice-language-en-header')).toBeUndefined();
  });
});
