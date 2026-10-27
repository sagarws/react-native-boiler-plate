import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import { captureSettingsStore } from '@/features/capture/store/captureSettings.store';
import { historyStore } from '@/features/capture/store/history.store';
import { onboardingStore } from '@/features/onboarding';
import { storage } from '@/store/mmkv';
import { themePresetPreference, typographyPreference } from '@/theme';
import App from '../../../App';

/**
 * End-to-end app flow under Jest: onboarding, home, settings, appearance and
 * the extracted-text screen. Structural assertions (texts, labels, testIDs,
 * persisted values), not snapshots, so they survive restyling. The native
 * module is absent here, as on iOS, so the overlay reports "unsupported".
 */

const HINDI = 'आपका Order Successfully Shipped हो गया है।';

function textsOf(root: ReactTestInstance): string[] {
  return root
    .findAllByType('Text' as never, { deep: true })
    .flatMap(node => node.children)
    .filter((child): child is string => typeof child === 'string');
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function renderApp() {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  if (!renderer) throw new Error('renderer failed to mount');
  mounted.push(renderer);
  return renderer;
}

function pressable(
  renderer: ReactTestRenderer.ReactTestRenderer,
  match: (p: Record<string, unknown>) => boolean,
) {
  return renderer.root.findAll(
    node => match(node.props) && typeof node.props.onPress === 'function',
  )[0];
}

async function pressLabel(
  renderer: ReactTestRenderer.ReactTestRenderer,
  label: string,
) {
  const target = pressable(renderer, p => p.accessibilityLabel === label);
  if (!target) throw new Error(`no pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    target.props.onPress();
  });
}

async function pressId(
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) {
  const target = pressable(renderer, p => p.testID === testID);
  if (!target) throw new Error(`no pressable with testID "${testID}"`);
  await ReactTestRenderer.act(async () => {
    target.props.onPress();
  });
}

function checked(
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
): boolean {
  const node = renderer.root.findAll(
    n => n.props.testID === testID && n.props.accessibilityState,
  )[0];
  return Boolean(node?.props.accessibilityState?.checked);
}

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
  historyStore.resetCacheForTest();
});

describe('first launch', () => {
  it('walks through onboarding and lands on home, without any login', async () => {
    const renderer = await renderApp();
    expect(textsOf(renderer.root)).toContain('Welcome to Akshar');

    await pressId(renderer, 'onboarding-next');
    expect(textsOf(renderer.root)).toContain('Which language do you read?');
    await pressId(renderer, 'ocr-mode-hindi');
    expect(captureSettingsStore.read().ocrMode).toBe('hindi');

    await pressId(renderer, 'onboarding-next');
    expect(textsOf(renderer.root)).toContain('Make it yours');
    await pressId(renderer, 'preset-emerald');
    expect(themePresetPreference.read()).toBe('emerald');

    await pressId(renderer, 'onboarding-next');
    expect(textsOf(renderer.root)).toContain('Two quick permissions');
    await pressId(renderer, 'onboarding-next');

    expect(onboardingStore.isComplete()).toBe(true);
    expect(textsOf(renderer.root)).toContain('Capture text from anywhere');
  });
});

describe('after onboarding', () => {
  beforeEach(() => onboardingStore.complete());

  it('shows the home dashboard with status, language, guide and empty history', async () => {
    const renderer = await renderApp();
    const texts = textsOf(renderer.root);

    expect(texts).toContain('Capture text from anywhere');
    expect(texts).toContain('Hindi + English');
    expect(texts).toContain('How it works');
    expect(texts).toContain('No extractions yet');
    // No native module under Jest: the toggle explains instead of failing.
    expect(
      renderer.root.findAll(n => n.props.testID === 'overlay-unsupported')
        .length,
    ).toBeGreaterThan(0);
  });

  it('opens a saved extraction and shows its Hindi text in the editor', async () => {
    historyStore.add([
      {
        id: 'h1',
        text: HINDI,
        mode: 'mixed',
        createdAt: Date.now(),
        durationMs: 420,
        lineCount: 1,
      },
    ]);
    const renderer = await renderApp();
    await pressId(renderer, 'result-h1');

    const editor = renderer.root.findAll(
      n => n.props.testID === 'extracted-editor' && 'value' in n.props,
    )[0];
    expect(editor.props.value).toBe(HINDI);
    expect(textsOf(renderer.root)).toContain('Extracted text');
  });

  it('edits and saves an extraction back to history', async () => {
    historyStore.add([
      {
        id: 'h1',
        text: 'old text',
        mode: 'english',
        createdAt: Date.now(),
        durationMs: 100,
        lineCount: 1,
      },
    ]);
    const renderer = await renderApp();
    await pressId(renderer, 'result-h1');
    await pressId(renderer, 'extracted-edit');

    const editor = renderer.root.findAll(
      n => n.props.testID === 'extracted-editor' && n.props.onChangeText,
    )[0];
    await ReactTestRenderer.act(async () => {
      editor.props.onChangeText(`${HINDI}\nline two`);
    });
    await pressId(renderer, 'extracted-edit');

    expect(historyStore.find('h1')).toMatchObject({
      text: `${HINDI}\nline two`,
      lineCount: 2,
    });
    expect(textsOf(renderer.root)).toContain('Changes saved');
  });

  it('updates home when history is cleared elsewhere', async () => {
    historyStore.add([
      {
        id: 'gone',
        text: 'x',
        mode: 'english',
        createdAt: Date.now(),
        durationMs: 1,
        lineCount: 1,
      },
    ]);
    const renderer = await renderApp();
    await ReactTestRenderer.act(async () => {
      historyStore.clear();
    });
    expect(textsOf(renderer.root)).toContain('No extractions yet');
  });

  it('splits Settings into General and OCR tabs', async () => {
    const renderer = await renderApp();
    // Home is the OCR part of the app.
    expect(
      renderer.root.findAll(n => n.props.testID === 'home-title')[0].props
        .children,
    ).toBe('OCR');
    await pressLabel(renderer, 'Open settings');
    // General (default): shared and app-wide settings.
    let texts = textsOf(renderer.root);
    for (const title of [
      'Gemini AI',
      'Speech & voice',
      'Share voice to Chrome',
    ]) {
      expect(texts).toContain(title);
    }
    expect(texts).not.toContain('Clipboard & history');
    // OCR: everything about capturing and processing screen text.
    await pressId(renderer, 'settings-tab-ocr');
    texts = textsOf(renderer.root);
    for (const title of [
      'OCR language',
      'Floating button',
      'Auto-scroll reading',
      'Speak with pagination',
      'Refine text',
      'Translation',
      'Clipboard & history',
    ]) {
      expect(texts).toContain(title);
    }
    expect(texts).not.toContain('Gemini AI');
  });

  it('shows every settings group collapsed to a one-line summary', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open settings');
    await pressId(renderer, 'settings-tab-ocr');
    const texts = textsOf(renderer.root);
    for (const title of [
      'OCR language',
      'Floating button',
      'Auto-scroll reading',
      'Speak with pagination',
      'Clipboard & history',
    ]) {
      expect(texts).toContain(title);
    }
    // Summaries come from real state.
    expect(texts).toContain('Hindi + English');
    expect(texts).toContain('Next button not pinned');
    expect(texts).toContain('Auto-copy On · History On');
    // Bodies are not rendered while collapsed.
    expect(texts).not.toContain('Action on floating button click');
  });

  it('keeps one settings group open at a time and never changes values when collapsing', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open settings');
    await pressId(renderer, 'settings-tab-ocr');
    await pressId(renderer, 'settings-ocr-header');
    await pressId(renderer, 'ocr-mode-gujarati');
    expect(captureSettingsStore.read().ocrMode).toBe('gujarati');

    // Opening another group closes the first.
    await pressId(renderer, 'settings-floating-header');
    expect(textsOf(renderer.root)).toContain('Action on floating button click');
    expect(
      renderer.root.findAll(n => n.props.testID === 'ocr-mode-gujarati').length,
    ).toBe(0);

    // Collapsing it again leaves every value untouched.
    await pressId(renderer, 'settings-floating-header');
    expect(captureSettingsStore.read().ocrMode).toBe('gujarati');
    expect(textsOf(renderer.root)).toContain('Gujarati');
  });

  it('changes the OCR language from Settings', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open settings');
    await pressId(renderer, 'settings-tab-ocr');
    await pressId(renderer, 'settings-ocr-header');

    await pressId(renderer, 'ocr-mode-english');
    expect(captureSettingsStore.read().ocrMode).toBe('english');
    expect(checked(renderer, 'ocr-mode-english')).toBe(true);
  });

  it('offers all seven OCR modes, including Gujarati combinations', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open settings');
    await pressId(renderer, 'settings-tab-ocr');
    await pressId(renderer, 'settings-ocr-header');
    const texts = textsOf(renderer.root);
    for (const label of [
      'English',
      'Hindi',
      'Gujarati',
      'Hindi + English',
      'Gujarati + English',
      'Hindi + Gujarati',
      'Hindi + Gujarati + English',
    ]) {
      expect(texts).toContain(label);
    }
    await pressId(renderer, 'ocr-mode-gujarati_english');
    expect(captureSettingsStore.read().ocrMode).toBe('gujarati_english');
  });

  it('selects the floating-button click action and persists it', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open settings');
    await pressId(renderer, 'settings-tab-ocr');
    await pressId(renderer, 'settings-floating-header');
    expect(textsOf(renderer.root)).toContain('Action on floating button click');

    await pressId(renderer, 'floating-action-speak_scroll');
    expect(captureSettingsStore.read().action).toBe('speak_scroll');
    expect(checked(renderer, 'floating-action-speak_scroll')).toBe(true);

    captureSettingsStore.resetCacheForTest();
    expect(captureSettingsStore.read().action).toBe('speak_scroll');
  });

  it('offers Speak with pagination as the fourth action, with its settings', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open settings');
    await pressId(renderer, 'settings-tab-ocr');
    await pressId(renderer, 'settings-floating-header');
    const texts = textsOf(renderer.root);
    expect(texts).toContain('Copy text only');
    expect(texts).toContain('Start speaking');
    expect(texts).toContain('Speak with auto-scroll');
    expect(texts).toContain('Speak with pagination');

    await pressId(renderer, 'floating-action-speak_pagination');
    expect(captureSettingsStore.read().action).toBe('speak_pagination');
    expect(checked(renderer, 'floating-action-speak_pagination')).toBe(true);

    await pressId(renderer, 'settings-pagination-header');
    expect(textsOf(renderer.root)).toContain('Next Page button');
  });

  it('shows Speech & voice and Auto-scroll reading settings', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open settings');
    await pressId(renderer, 'settings-speech-header');
    // Without the native module the speech section says so instead of guessing.
    expect(textsOf(renderer.root)).toContain('Speech needs Android.');

    await pressId(renderer, 'settings-tab-ocr');
    await pressId(renderer, 'settings-reading-header');
    expect(textsOf(renderer.root)).toContain(
      'Why auto-scroll needs accessibility access',
    );

    const toggle = renderer.root.findAll(
      n => n.props.testID === 'reading-auto-scroll' && n.props.onValueChange,
    )[0];
    await ReactTestRenderer.act(async () => {
      toggle.props.onValueChange(false);
    });
    expect(captureSettingsStore.read().reading.autoScroll).toBe(false);
  });

  it('turns history off from Settings', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open settings');
    await pressId(renderer, 'settings-tab-ocr');
    await pressId(renderer, 'settings-clipboard-header');
    const toggle = renderer.root.findAll(
      n => n.props.testID === 'settings-save-history' && n.props.onValueChange,
    )[0];
    await ReactTestRenderer.act(async () => {
      toggle.props.onValueChange(false);
    });
    expect(captureSettingsStore.read().saveHistory).toBe(false);
  });

  it('applies a colour preset and a text style immediately and persists them', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open settings');
    await pressId(renderer, 'settings-appearance');
    expect(textsOf(renderer.root)).toContain('Theme colours');

    await pressId(renderer, 'preset-oceanBlue');
    expect(themePresetPreference.read()).toBe('oceanBlue');
    // The checked state comes from the live theme context: the UI updated.
    expect(checked(renderer, 'preset-oceanBlue')).toBe(true);
    expect(checked(renderer, 'preset-violet')).toBe(false);

    await pressId(renderer, 'typography-classic');
    expect(typographyPreference.read()).toBe('classic');
    expect(checked(renderer, 'typography-classic')).toBe(true);

    // The preview heading is now set in the Classic face.
    const heading = renderer.root
      .findAllByType('Text' as never)
      .find(n => n.props.children === 'आपका Order Shipped हो गया');
    const flat = [heading?.props.style].flat(Infinity) as {
      fontFamily?: string;
    }[];
    expect(flat.some(s => s?.fontFamily === 'serif')).toBe(true);
  });

  it('reaches every main screen from the drawer', async () => {
    const renderer = await renderApp();
    await pressLabel(renderer, 'Open menu');
    await pressLabel(renderer, 'Privacy & help');
    expect(textsOf(renderer.root)).toContain('Permissions and why');
  });
});
