import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import {
  DrawerContext,
  type DrawerControls,
} from '@/navigation/drawer/DrawerContext';
import { Header } from './Header';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, canGoBack: () => true }),
}));

const openDrawer = jest.fn();
const drawer: DrawerControls = {
  available: true,
  isOpen: false,
  openDrawer,
  closeDrawer: jest.fn(),
};

function render(node: React.ReactElement, controls: DrawerControls = drawer) {
  let r: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    r = ReactTestRenderer.create(
      <DrawerContext.Provider value={controls}>{node}</DrawerContext.Provider>,
    );
  });
  return r!;
}
const menu = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(
    n =>
      n.props.testID === 'header-menu' && typeof n.props.onPress === 'function',
  );

beforeEach(() => jest.clearAllMocks());

describe('Header global menu', () => {
  it('opens the side drawer from any screen header', () => {
    const r = render(<Header label="Deep screen" />);
    expect(menu(r)).toHaveLength(1);
    ReactTestRenderer.act(() => menu(r)[0].props.onPress());
    expect(openDrawer).toHaveBeenCalledTimes(1);
  });

  it('is hidden outside the signed-in app (no DrawerHost)', () => {
    const r = render(<Header label="Login" />, { ...drawer, available: false });
    expect(menu(r)).toHaveLength(0);
  });

  it('is hidden for modal headers with a custom back action, unless asked for', () => {
    const onClose = jest.fn();
    expect(
      menu(render(<Header label="Modal" onBackPress={onClose} />)),
    ).toHaveLength(0);
    expect(
      menu(render(<Header label="Modal" onBackPress={onClose} menu />)),
    ).toHaveLength(1);
    expect(menu(render(<Header label="Plain" menu={false} />))).toHaveLength(0);
  });

  it('keeps the back button working', () => {
    const r = render(<Header label="Deep screen" />);
    const back = r.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Back' &&
        typeof n.props.onPress === 'function',
    )[0];
    ReactTestRenderer.act(() => back.props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
  });
});
