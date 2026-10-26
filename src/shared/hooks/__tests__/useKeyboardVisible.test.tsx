import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Keyboard, Text } from 'react-native';
import { useKeyboardVisible } from '../useKeyboardVisible';

type Handler = (...args: unknown[]) => void;

const handlers: Record<string, Handler> = {};
let removed: string[] = [];

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key];
  removed = [];
  jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation(((event: string, handler: Handler) => {
      handlers[event] = handler;
      return {
        remove: () => {
          removed.push(event);
          delete handlers[event];
        },
      } as ReturnType<typeof Keyboard.addListener>;
      // Cast: the real signature is typed to KeyboardEventListener, but the
      // hook never reads the event payload.
    }) as unknown as typeof Keyboard.addListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function Probe() {
  const visible = useKeyboardVisible();
  return <Text>{visible ? 'up' : 'down'}</Text>;
}

async function mount() {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<Probe />);
  });
  if (!renderer) throw new Error('failed to mount');
  return renderer;
}

const rendered = (r: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON());

describe('useKeyboardVisible', () => {
  it('starts down and follows show then hide', async () => {
    const renderer = await mount();
    expect(rendered(renderer)).toContain('down');

    await ReactTestRenderer.act(() => handlers.keyboardDidShow());
    expect(rendered(renderer)).toContain('up');

    await ReactTestRenderer.act(() => handlers.keyboardDidHide());
    expect(rendered(renderer)).toContain('down');
  });

  // A screen unmounting mid-edit must not leave a listener behind.
  it('removes both listeners on unmount', async () => {
    const renderer = await mount();
    await ReactTestRenderer.act(() => {
      renderer.unmount();
    });
    expect(removed.sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
  });
});
