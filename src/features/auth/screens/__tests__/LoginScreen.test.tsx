import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import '@/i18n';
import {
  clearApiBaseUrlOverride,
  FEATURES,
  getApiBaseUrl,
  getDefaultApiBaseUrl,
  setApiBaseUrlOverride,
} from '@/config';
import LoginScreen from '../LoginScreen';

/**
 * The endpoint sheet is how a build gets pointed at a laptop or a tunnel
 * without a rebuild. It can be switched off per build, so these read the flag
 * rather than assume either answer.
 */

const describeSheet = FEATURES.loginDevSettings ? describe : describe.skip;

function textsOf(root: ReactTestInstance): string[] {
  return root
    .findAllByType('Text' as never, { deep: true })
    .flatMap(node => node.children)
    .filter((child): child is string => typeof child === 'string');
}

async function render() {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<LoginScreen />);
  });
  if (!renderer) throw new Error('renderer failed to mount');
  return renderer;
}

async function press(
  renderer: ReactTestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> {
  const target = renderer.root.findAll(
    node =>
      node.props.accessibilityLabel === label && Boolean(node.props.onPress),
  )[0];
  if (!target) throw new Error(`no pressable labelled "${label}"`);
  await ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

describe('LoginScreen', () => {
  afterEach(() => {
    clearApiBaseUrlOverride();
  });

  it('renders the sign-in form', async () => {
    const renderer = await render();
    expect(
      renderer.root.findAllByProps({ testID: 'login-submit' }).length,
    ).toBeGreaterThan(0);
  });

  it('shows the gear only when the developer sheet is enabled', async () => {
    const renderer = await render();
    const gears = renderer.root.findAll(
      node => node.props.accessibilityLabel === 'Developer settings',
    );
    expect(gears.length > 0).toBe(FEATURES.loginDevSettings);
  });

  /**
   * With the sheet hidden there is no way to inspect or clear an override, so
   * a value stored by an earlier build must not keep the app pointed
   * somewhere else.
   */
  it('uses the built-in endpoint when the sheet is hidden', () => {
    setApiBaseUrlOverride('https://stale.test');
    if (FEATURES.loginDevSettings)
      expect(getApiBaseUrl()).toBe('https://stale.test');
    else expect(getApiBaseUrl()).toBe(getDefaultApiBaseUrl());
  });
});

describeSheet('LoginScreen developer sheet', () => {
  afterEach(() => {
    clearApiBaseUrlOverride();
  });

  it('opens from the gear', async () => {
    const renderer = await render();

    expect(textsOf(renderer.root)).not.toContain('Developer settings');
    await press(renderer, 'Developer settings');

    const texts = textsOf(renderer.root);
    expect(texts).toContain('Developer settings');
    expect(texts).toContain('API base URL');
  });

  // The sheet seeds from the current value, so the field shows what the app
  // is actually pointed at rather than a blank box.
  it('seeds the field with the endpoint in force', async () => {
    const renderer = await render();
    await press(renderer, 'Developer settings');

    const inputs = renderer.root.findAllByType('TextInput' as never);
    const urlInput = inputs.find(i => i.props.keyboardType === 'url');
    expect(urlInput?.props.value).toBe(getDefaultApiBaseUrl());
  });

  it('reroutes the app when a new endpoint is saved', async () => {
    const renderer = await render();
    await press(renderer, 'Developer settings');

    const inputs = renderer.root.findAllByType('TextInput' as never);
    const urlInput = inputs.find(i => i.props.keyboardType === 'url');
    await ReactTestRenderer.act(() => {
      urlInput?.props.onChangeText('https://example.test/');
    });
    await press(renderer, 'Save');

    // Trailing slash is normalised away so callers can concatenate paths.
    expect(getApiBaseUrl()).toBe('https://example.test');
  });

  it('rejects a value that is not a URL', async () => {
    const renderer = await render();
    await press(renderer, 'Developer settings');

    const inputs = renderer.root.findAllByType('TextInput' as never);
    const urlInput = inputs.find(i => i.props.keyboardType === 'url');
    await ReactTestRenderer.act(() => {
      urlInput?.props.onChangeText('not-a-url');
    });
    await press(renderer, 'Save');

    expect(textsOf(renderer.root).join(' ')).toContain('Enter a full URL');
    expect(getApiBaseUrl()).toBe(getDefaultApiBaseUrl());
  });
});
