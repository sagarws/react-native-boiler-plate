import {
  parseOcrResult,
  parseOcrResultJson,
  parseOcrResultList,
} from '../utils/parseResult';
import { previewText, selectedOrAll, countLines } from '../utils/text';

const HINDI = 'आपका Order Successfully Shipped हो गया है।\nदूसरी पंक्ति 123';

describe('parseOcrResult', () => {
  it('keeps Hindi and English text byte for byte', () => {
    const parsed = parseOcrResultJson(
      JSON.stringify({
        id: '1',
        text: HINDI,
        mode: 'mixed',
        createdAt: 5,
        durationMs: 420,
        lineCount: 2,
      }),
    );
    expect(parsed?.text).toBe(HINDI);
    expect(parsed?.mode).toBe('mixed');
  });

  it('rejects unknown modes, missing ids and non-objects', () => {
    expect(parseOcrResult({ id: '1', text: 'x', mode: 'tamil' })).toBeNull();
    expect(parseOcrResult({ text: 'x', mode: 'english' })).toBeNull();
    expect(parseOcrResult('x')).toBeNull();
    expect(parseOcrResultJson('')).toBeNull();
    expect(parseOcrResultJson('{oops')).toBeNull();
  });

  it('fills safe defaults for missing numbers', () => {
    expect(parseOcrResult({ id: '1', text: 'a\nb', mode: 'hindi' })).toEqual({
      id: '1',
      text: 'a\nb',
      mode: 'hindi',
      createdAt: 0,
      durationMs: 0,
      lineCount: 2,
    });
  });

  it('parses lists and skips bad entries', () => {
    const json = JSON.stringify([
      { id: '1', text: 'a', mode: 'english' },
      { nope: true },
    ]);
    expect(parseOcrResultList(json).map(r => r.id)).toEqual(['1']);
    expect(parseOcrResultList('not json')).toEqual([]);
  });
});

describe('text utils', () => {
  it('copies only the selection when one exists', () => {
    expect(selectedOrAll(HINDI, { start: 0, end: 4 })).toBe('आपका');
    expect(selectedOrAll(HINDI, { start: 3, end: 3 })).toBe(HINDI);
    expect(selectedOrAll(HINDI, null)).toBe(HINDI);
  });

  it('builds a one-line preview', () => {
    expect(previewText('a\n\nb   c')).toBe('a b c');
    expect(previewText('word '.repeat(50), 20).endsWith('…')).toBe(true);
  });

  it('counts lines', () => {
    expect(countLines('')).toBe(0);
    expect(countLines(HINDI)).toBe(2);
  });
});
