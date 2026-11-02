import { addToAmount, quickAddSteps } from '../utils/format';

describe('quickAddSteps', () => {
  it('offers +5, +10, +15 for everyday targets', () => {
    expect(quickAddSteps(60)).toEqual([5, 10, 15]);
    expect(quickAddSteps(10)).toEqual([5, 10, 15]);
    expect(quickAddSteps(999)).toEqual([5, 10, 15]);
  });

  it('uses +1, +2, +3 for tiny targets', () => {
    expect(quickAddSteps(3)).toEqual([1, 2, 3]);
    expect(quickAddSteps(0.5)).toEqual([1, 2, 3]);
  });

  it('scales up for big targets', () => {
    expect(quickAddSteps(1000)).toEqual([50, 100, 150]);
    expect(quickAddSteps(10000)).toEqual([500, 1000, 1500]);
  });

  it('falls back to +5, +10, +15 without a valid target', () => {
    expect(quickAddSteps(0)).toEqual([5, 10, 15]);
    expect(quickAddSteps(NaN)).toEqual([5, 10, 15]);
  });
});

describe('addToAmount', () => {
  it('adds to what is typed, treating empty or invalid as 0', () => {
    expect(addToAmount('', 5)).toBe('5');
    expect(addToAmount('10', 15)).toBe('25');
    expect(addToAmount('2,5', 5)).toBe('7.5');
    expect(addToAmount('abc', 10)).toBe('10');
  });
});
