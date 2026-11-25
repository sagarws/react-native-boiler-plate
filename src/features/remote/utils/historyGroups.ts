import { parseDeviceId } from '../core/ids';
import type { HistoryEntry } from '../types';

/** One History row: a device's newest entry, and how many entries it stands for. */
export interface HistoryGroup {
  latest: HistoryEntry;
  count: number;
}

/**
 * History shows each device once per direction (connecting 10 times to the same
 * computer is one row, "10 times"), newest first. Entries without an ID are
 * grouped by name. Input is newest first, as stored.
 */
export const groupHistory = (history: HistoryEntry[]): HistoryGroup[] => {
  const groups = new Map<string, HistoryGroup>();
  for (const entry of history) {
    const who =
      parseDeviceId(entry.peerId) ?? `name:${entry.peerName || entry.peerId}`;
    const key = `${entry.direction}|${who}`;
    const group = groups.get(key);
    if (group) {
      group.count++;
      if (entry.at > group.latest.at) group.latest = entry;
    } else groups.set(key, { latest: entry, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.latest.at - a.latest.at);
};
