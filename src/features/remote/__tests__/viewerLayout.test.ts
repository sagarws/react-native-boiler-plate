import { videoRect } from '../utils/geometry';
import { groupHistory } from '../utils/historyGroups';
import type { HistoryEntry } from '../types';

describe('videoRect alignTop (keyboard open)', () => {
  const container = { width: 400, height: 300 };
  const wide = { width: 1600, height: 900 }; // fits by width: 400 × 225

  it('centres by default', () => {
    expect(videoRect(container, wide, 1, { x: 0, y: 0 })).toEqual({
      left: 0,
      top: 37.5,
      width: 400,
      height: 225,
    });
  });

  it('puts a shorter picture at the top when asked', () => {
    expect(videoRect(container, wide, 1, { x: 0, y: 0 }, true).top).toBe(0);
  });

  it('a zoomed picture taller than the space still pans around its centre', () => {
    const r = videoRect(container, wide, 2, { x: 0, y: 0 }, true);
    expect(r.height).toBe(450);
    expect(r.top).toBe(-75);
  });
});

const entry = (over: Partial<HistoryEntry>): HistoryEntry =>
  ({
    at: 0,
    direction: 'outgoing',
    event: 'connected',
    peerId: '00645969',
    peerName: 'Mac',
    detail: '',
    ...over,
  } as HistoryEntry);

describe('groupHistory', () => {
  it('shows a device once per direction with its newest entry and a count', () => {
    const history = [
      entry({ at: 50, event: 'ended' }),
      entry({ at: 40 }),
      entry({ at: 30, peerId: '0064 5969' }),
      entry({ at: 20, direction: 'incoming' }),
      entry({ at: 10, peerId: '19304289', peerName: 'PC' }),
    ];
    const groups = groupHistory(history);
    expect(groups.map(g => [g.latest.at, g.count])).toEqual([
      [50, 3],
      [20, 1],
      [10, 1],
    ]);
    expect(groups[0]?.latest.event).toBe('ended');
  });

  it('groups entries without an ID by name', () => {
    const groups = groupHistory([
      entry({ at: 2, peerId: '', peerName: '10.0.0.5' }),
      entry({ at: 1, peerId: '', peerName: '10.0.0.5' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(2);
  });
});
