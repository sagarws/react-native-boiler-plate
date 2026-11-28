import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import {
  DrawerContext,
  type DrawerControls,
} from '@/navigation/drawer/DrawerContext';
import { Header } from '../Header';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, canGoBack: () => true }),
}));

type Renderer = ReactTestRenderer.ReactTestRenderer;

async function render(ui: React.ReactElement) {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(ui);
  });
  return r!;
}

const pressables = (r: Renderer, label: string) =>
  r.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  );

const drawer = (openDrawer: () => void): DrawerControls => ({
  available: true,
  isOpen: false,
  openDrawer,
  closeDrawer: jest.fn(),
});

describe('Header', () => {
  beforeEach(() => mockGoBack.mockClear());

  it('gives sub-screens both back and the side-menu button', async () => {
    const openDrawer = jest.fn();
    const r = await render(
      <DrawerContext.Provider value={drawer(openDrawer)}>
        <Header label="Child" />
      </DrawerContext.Provider>,
    );
    const back = pressables(r, 'Back');
    const menu = pressables(r, 'Open menu');
    expect(back).toHaveLength(1);
    expect(menu).toHaveLength(1);

    await ReactTestRenderer.act(async () => menu[0]!.props.onPress());
    expect(openDrawer).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => back[0]!.props.onPress());
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('shows a single menu button on root screens', async () => {
    const onMenuPress = jest.fn();
    const r = await render(
      <DrawerContext.Provider value={drawer(jest.fn())}>
        <Header label="Root" onMenuPress={onMenuPress} />
      </DrawerContext.Provider>,
    );
    expect(pressables(r, 'Back')).toHaveLength(0);
    expect(pressables(r, 'Open menu')).toHaveLength(1);
    r.unmount();
  });

  it('has no menu button where there is no side panel', async () => {
    const r = await render(<Header label="Sign in" />);
    expect(pressables(r, 'Back')).toHaveLength(1);
    expect(pressables(r, 'Open menu')).toHaveLength(0);
    r.unmount();
  });
});
