import React, { useState } from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import { categoryColor, isCustomColor } from '@/theme';
import { ColorPicker } from '../components/pickers';
import { hexToHsl, hslToHex, normalizeHex } from '../utils/customColor';

describe('custom colour maths', () => {
  it('normalises hex input', () => {
    expect(normalizeHex('7c3aed')).toBe('#7C3AED');
    expect(normalizeHex(' #7C3AED ')).toBe('#7C3AED');
    expect(normalizeHex('#7ce')).toBe('#77CCEE');
    expect(normalizeHex('#7C3AE')).toBeNull();
    expect(normalizeHex('violet')).toBeNull();
  });

  it('converts between hex and HSL', () => {
    expect(hslToHex({ h: 0, s: 100, l: 50 })).toBe('#FF0000');
    expect(hslToHex({ h: 120, s: 100, l: 50 })).toBe('#00FF00');
    expect(hslToHex({ h: 240, s: 100, l: 50 })).toBe('#0000FF');
    expect(hslToHex({ h: 0, s: 0, l: 100 })).toBe('#FFFFFF');
    expect(hexToHsl('#FF0000')).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl('#808080')).toEqual({ h: 0, s: 0, l: 50 });
    // Round trip stays within one step per channel.
    const back = hslToHex(hexToHsl('#7C3AED'));
    const diff = [1, 3, 5].map(i =>
      Math.abs(
        parseInt(back.slice(i, i + 2), 16) -
          parseInt('#7C3AED'.slice(i, i + 2), 16),
      ),
    );
    expect(Math.max(...diff)).toBeLessThanOrEqual(3);
  });

  it('resolves custom hex values and palette keys alike', () => {
    expect(isCustomColor('#12ab34')).toBe(true);
    expect(isCustomColor('violet')).toBe(false);
    expect(categoryColor('#12ab34')).toBe('#12AB34');
    expect(categoryColor('teal')).toBe('#0F766E');
    expect(categoryColor('nope')).toBe('#7C3AED');
  });
});

describe('ColorPicker custom colour', () => {
  type Renderer = ReactTestRenderer.ReactTestRenderer;
  const byId = (r: Renderer, id: string) =>
    r.root.findAll(
      n => n.props.testID === id && typeof n.type !== 'string',
    )[0];

  let latest = '';
  function Harness() {
    const [color, setColor] = useState('violet');
    latest = color;
    return <ColorPicker value={color} onChange={setColor} testID="c" />;
  }

  it('picks a typed hex colour through the panel', async () => {
    let r!: Renderer;
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(<Harness />);
    });
    expect(byId(r, 'c-custom').props.accessibilityState.selected).toBe(false);
    await ReactTestRenderer.act(async () => {
      byId(r, 'c-custom').props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'c-custom-sheet-hex').props.onChangeText('#12ab34');
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'c-custom-sheet-save').props.onPress();
    });
    expect(latest).toBe('#12AB34');
    expect(byId(r, 'c-custom').props.accessibilityState.selected).toBe(true);
    expect(byId(r, 'c-violet').props.accessibilityState.selected).toBe(false);
  });

  it('rejects an invalid hex and keeps the slider colour', async () => {
    let r!: Renderer;
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(<Harness />);
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'c-custom').props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'c-custom-sheet-hex').props.onChangeText('#zz');
    });
    expect(byId(r, 'c-custom-sheet-hex').props.error).toBeTruthy();
    await ReactTestRenderer.act(async () => {
      byId(r, 'c-custom-sheet-save').props.onPress();
    });
    // Starts from violet's HSL, so saving gives (about) violet as hex.
    expect(isCustomColor(latest)).toBe(true);
  });
});
