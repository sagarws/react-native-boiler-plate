import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import { sessionStore } from '@/features/session';
import type { Session } from '@/features/session';
import App from '../../../App';

/**
 * Covers the shape of the signed-in navigation: a dashboard behind a side
 * drawer, with further screens pushed on top of it. These are structural
 * assertions rather than snapshots — they should survive restyling and only
 * fail if a route or the drawer actually stops working.
 */

const SESSION: Session = {
  accessToken: 'test-token',
  user: {
    id: 'user-1',
    name: 'Asha Rao',
    email: 'asha@example.test',
  },
};

function textsOf(root: ReactTestInstance): string[] {
  return root
    .findAllByType('Text' as never, { deep: true })
    .flatMap(node => node.children)
    .filter((child): child is string => typeof child === 'string');
}

// Every mounted tree stays subscribed to the session store, so a tree left
// over from one test would re-render on the next test's session write.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function renderApp() {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  if (!renderer) throw new Error('renderer failed to mount');
  mounted.push(renderer);
  return renderer;
}

/** Taps the first pressable carrying `label` as its accessible name. */
async function press(
  renderer: ReactTestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> {
  const target = renderer.root.findAll(
    node => node.props.accessibilityLabel === label && Boolean(node.props.onPress),
  )[0];
  if (!target) throw new Error(`no pressable labelled "${label}"`);
  await ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

async function openDrawer(renderer: ReactTestRenderer.ReactTestRenderer): Promise<void> {
  await press(renderer, 'Open menu');
}

describe('signed-in navigation', () => {
  afterEach(async () => {
    await ReactTestRenderer.act(() => {
      mounted.splice(0).forEach(r => r.unmount());
    });
    sessionStore.clear();
  });

  it('lands on the dashboard and greets the user', async () => {
    sessionStore.write(SESSION);
    const renderer = await renderApp();

    expect(textsOf(renderer.root)).toContain('Welcome, Asha Rao');
  });

  it('opens the drawer from the dashboard and shows who is signed in', async () => {
    sessionStore.write(SESSION);
    const renderer = await renderApp();

    await openDrawer(renderer);

    const texts = textsOf(renderer.root);
    expect(texts).toContain('Asha Rao');
    expect(texts).toContain('asha@example.test');
    expect(texts).toContain('Sign out');
  });

  // The drawer wraps the main stack instead of sitting inside it, so its
  // navigation object is the root navigator's. This covers the nested
  // navigate that fact forces — a plain navigate('Settings') silently no-ops.
  it('navigates to Settings from the drawer', async () => {
    sessionStore.write(SESSION);
    const renderer = await renderApp();

    await openDrawer(renderer);
    await press(renderer, 'Settings');

    const texts = textsOf(renderer.root);
    expect(texts).toContain('Theme');
    expect(texts).toContain('Account');
  });

  it('returns to the login screen when the session is cleared', async () => {
    sessionStore.write(SESSION);
    const renderer = await renderApp();

    await ReactTestRenderer.act(() => {
      sessionStore.clear();
    });

    expect(renderer.root.findAllByProps({ testID: 'login-submit' }).length).toBeGreaterThan(0);
  });

  it('shows the login screen when there is no session', async () => {
    const renderer = await renderApp();
    expect(renderer.root.findAllByProps({ testID: 'login-submit' }).length).toBeGreaterThan(0);
  });
});
