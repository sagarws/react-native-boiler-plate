import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import { Slider } from './Slider';

async function render(props: Partial<React.ComponentProps<typeof Slider>> = {}) {
  const onChange = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <Slider
        value={100}
        min={10}
        max={100}
        step={10}
        onChange={onChange}
        accessibilityLabel="Video quality"
        testID="slider"
        {...props}
      />,
    );
  });
  if (!renderer) throw new Error('renderer failed to mount');
  // `findByProps` would match the Slider element itself first; the
  // accessibility props under test live on the host View it renders.
  const [host] = renderer.root.findAll(
    node => node.props.testID === 'slider' && typeof node.type === 'string',
  );
  return { root: host, onChange };
}

function act(node: ReactTestInstance, actionName: 'increment' | 'decrement') {
  ReactTestRenderer.act(() => {
    node.props.onAccessibilityAction({ nativeEvent: { actionName } });
  });
}

describe('Slider', () => {
  it('reports the current position to a screen reader', async () => {
    const { root } = await render({ value: 70 });

    expect(root.props.accessibilityRole).toBe('adjustable');
    expect(root.props.accessibilityValue).toMatchObject({ min: 10, max: 100, now: 70 });
  });

  it('moves one step per accessibility action', async () => {
    const { root, onChange } = await render({ value: 70 });

    act(root, 'decrement');
    expect(onChange).toHaveBeenCalledWith(60);

    act(root, 'increment');
    expect(onChange).toHaveBeenCalledWith(80);
  });

  it('does not emit past either end of the range', async () => {
    const { root, onChange } = await render({ value: 100 });
    act(root, 'increment');
    expect(onChange).not.toHaveBeenCalled();

    const bottom = await render({ value: 10 });
    act(bottom.root, 'decrement');
    expect(bottom.onChange).not.toHaveBeenCalled();
  });

  it('ignores input while disabled', async () => {
    const { root, onChange } = await render({ value: 50, disabled: true });

    act(root, 'increment');

    expect(onChange).not.toHaveBeenCalled();
  });
});
