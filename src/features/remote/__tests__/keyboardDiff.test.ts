import { SENTINEL, textDiff } from '../hooks/useRemoteKeyboard';

describe('remote keyboard diff', () => {
  it('types only the new character each time (no repeats)', () => {
    let field = SENTINEL;
    const typed: string[] = [];
    for (const ch of ['a', 'b', 'c']) {
      const next = field + ch;
      const d = textDiff(field, next);
      expect(d.removed).toBe(0);
      typed.push(d.added);
      field = next;
    }
    expect(typed.join('')).toBe('abc');
  });

  it('counts Backspace as removed characters', () => {
    expect(textDiff(`${SENTINEL}ab`, `${SENTINEL}a`)).toEqual({
      removed: 1,
      added: '',
    });
    expect(textDiff(SENTINEL, '•')).toEqual({ removed: 1, added: '' });
  });

  it('turns a replaced word into backspaces plus the new text', () => {
    expect(textDiff(`${SENTINEL}teh`, `${SENTINEL}the`)).toEqual({
      removed: 2,
      added: 'he',
    });
  });
});
