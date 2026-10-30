import { hexToArgb } from '../services/recorder.service';
import {
  canMerge,
  canPlay,
  clampSegmentMinutes,
  DEFAULT_RECORDER_CONFIG,
  displayDurationMs,
  estimateBytesPerHour,
  filterRecordings,
  formatBytes,
  isBusy,
  isCapturing,
  parseCapabilities,
  parseConfig,
  parseRecordings,
  parseSegmentMinutes,
  parseStatus,
  UNSUPPORTED_STATUS,
} from '../services/recordings';
import type { Recording } from '../recorder.types';

jest.mock('@/specs/NativeRecorder', () => ({
  __esModule: true,
  default: null,
}));

const entry = (over: Record<string, unknown>) => ({
  id: 'r1',
  type: 'video',
  name: 'ScreenRecording_2026-10-30_10-30-15_Final.mp4',
  uri: 'content://media/1',
  createdAt: 1000,
  durationMs: 600_000,
  sizeBytes: 50_000_000,
  width: 720,
  height: 1600,
  fps: 30,
  audio: 'system',
  status: 'completed',
  segments: [],
  ...over,
});

const seg = (index: number, status: string, durationUs = 60_000_000) => ({
  index,
  name: `Session_20261030_103015_Segment_00${index + 1}.mp4`,
  uri: `file:///s/${index}.mp4`,
  startUs: index * 60_000_000,
  durationUs,
  sizeBytes: 5_000_000,
  status,
});

describe('parseConfig', () => {
  it('fills defaults for missing or invalid values', () => {
    expect(parseConfig('{}')).toEqual(DEFAULT_RECORDER_CONFIG);
    expect(parseConfig('not json')).toEqual(DEFAULT_RECORDER_CONFIG);
    const c = parseConfig(
      JSON.stringify({
        mode: 'bogus',
        videoPreset: 'ultra',
        segmentMinutes: 999,
      }),
    );
    expect(c.mode).toBe('screenshot');
    expect(c.videoPreset).toBe('medium');
    expect(c.segmentMinutes).toBe(120);
  });

  it('keeps valid values', () => {
    const c = parseConfig(
      JSON.stringify({
        mode: 'screen_voice',
        audioSource: 'system_mic',
        segmentMinutes: 1,
        keepSegments: true,
        customVideo: { height: 1080, fps: 60, bitrate: 9_000_000 },
      }),
    );
    expect(c.mode).toBe('screen_voice');
    expect(c.audioSource).toBe('system_mic');
    expect(c.segmentMinutes).toBe(1);
    expect(c.keepSegments).toBe(true);
    expect(c.customVideo).toEqual({
      height: 1080,
      fps: 60,
      bitrate: 9_000_000,
    });
  });

  it('defaults to 5-minute segments with auto-merge, deleting parts only after verify', () => {
    expect(DEFAULT_RECORDER_CONFIG.segmentEnabled).toBe(true);
    expect(DEFAULT_RECORDER_CONFIG.segmentMinutes).toBe(5);
    expect(DEFAULT_RECORDER_CONFIG.autoMerge).toBe(true);
    // Screenshots are never saved silently unless the user opts in.
    expect(DEFAULT_RECORDER_CONFIG.autoSaveScreenshot).toBe(false);
  });
});

describe('segment minutes', () => {
  it('accepts whole minutes 1–120 only', () => {
    expect(parseSegmentMinutes('7')).toBe(7);
    expect(parseSegmentMinutes(' 120 ')).toBe(120);
    expect(parseSegmentMinutes('0')).toBeNull();
    expect(parseSegmentMinutes('121')).toBeNull();
    expect(parseSegmentMinutes('2.5')).toBeNull();
    expect(parseSegmentMinutes('abc')).toBeNull();
  });

  it('clamps stored values', () => {
    expect(clampSegmentMinutes(0)).toBe(1);
    expect(clampSegmentMinutes(500)).toBe(120);
    expect(clampSegmentMinutes(NaN)).toBe(5);
    expect(clampSegmentMinutes(2.4)).toBe(2);
  });
});

describe('parseStatus', () => {
  it('merges a partial state event over the previous status', () => {
    const base = parseStatus(
      JSON.stringify({
        supported: true,
        overlayPermission: true,
        state: 'idle',
        bubbleShown: true,
      }),
    );
    const next = parseStatus(
      {
        state: 'recording',
        elapsedMs: 4200,
        segment: 3,
        content: 'Video only',
      },
      base,
    );
    expect(next.overlayPermission).toBe(true);
    expect(next.bubbleShown).toBe(true);
    expect(next.state).toBe('recording');
    expect(next.segment).toBe(3);
    expect(next.elapsedMs).toBe(4200);
  });

  it('rejects unknown states and bad JSON', () => {
    expect(parseStatus({ state: 'exploded' }).state).toBe('idle');
    expect(parseStatus('{oops', UNSUPPORTED_STATUS)).toBe(UNSUPPORTED_STATUS);
  });

  it('classifies capturing and busy states', () => {
    expect(isCapturing('recording')).toBe(true);
    expect(isCapturing('paused')).toBe(true);
    expect(isCapturing('merging')).toBe(false);
    expect(isBusy('merging')).toBe(true);
    expect(isBusy('stopping')).toBe(true);
    expect(isBusy('completed')).toBe(false);
    expect(isBusy('interrupted')).toBe(false);
  });
});

describe('library', () => {
  const list = parseRecordings(
    JSON.stringify([
      entry({ id: 'v1', createdAt: 3 }),
      entry({ id: 's1', type: 'screenshot', createdAt: 5 }),
      entry({ id: 'a1', type: 'audio', createdAt: 4 }),
      entry({
        id: 'p1',
        status: 'processing',
        uri: '',
        createdAt: 6,
        segments: [seg(0, 'done')],
      }),
      entry({
        id: 'i1',
        status: 'interrupted',
        uri: '',
        createdAt: 2,
        durationMs: 0,
        segments: [seg(0, 'done'), seg(1, 'done'), seg(2, 'failed', 0)],
      }),
      entry({ id: 'f1', status: 'failed', uri: '', createdAt: 1 }),
      { id: 42 }, // dropped: invalid
    ]),
  );
  const ids = (l: Recording[]) => l.map(r => r.id);

  it('drops invalid entries and sorts newest first', () => {
    expect(ids(list)).toEqual(['p1', 's1', 'a1', 'v1', 'i1', 'f1']);
  });

  it('filters by tab; unfinished sessions never count as videos', () => {
    expect(ids(filterRecordings(list, 'screenshots'))).toEqual(['s1']);
    expect(ids(filterRecordings(list, 'videos'))).toEqual(['v1']);
    expect(ids(filterRecordings(list, 'audio'))).toEqual(['a1']);
    expect(ids(filterRecordings(list, 'processing'))).toEqual(['p1']);
    expect(ids(filterRecordings(list, 'interrupted'))).toEqual(['i1']);
    expect(ids(filterRecordings(list, 'failed'))).toEqual(['f1']);
    expect(filterRecordings(list, 'all')).toHaveLength(6);
  });

  it('plays only verified final files, merges only kept parts', () => {
    const byId = (id: string) => list.find(r => r.id === id)!;
    expect(canPlay(byId('v1'))).toBe(true);
    expect(canPlay(byId('i1'))).toBe(false);
    expect(canMerge(byId('i1'))).toBe(true);
    // Still being written: no merge.
    expect(canMerge(byId('p1'))).toBe(false);
    expect(canMerge(byId('s1'))).toBe(false);
  });

  it('sums finished parts for an unmerged session', () => {
    const interrupted = list.find(r => r.id === 'i1')!;
    expect(displayDurationMs(interrupted)).toBe(120_000);
    expect(interrupted.segments.map(s => s.index)).toEqual([0, 1, 2]);
  });
});

describe('formatting and estimates', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });

  it('estimates storage per hour', () => {
    // 4 Mbps video + 128 kbps audio ≈ 1.86 GB/hour.
    expect(estimateBytesPerHour(4_000_000, 128_000)).toBe(1_857_600_000);
  });

  it('parses encoder capabilities', () => {
    const caps = parseCapabilities(
      JSON.stringify({
        screenWidth: 1080,
        screenHeight: 2400,
        encoder: 'c2.qti.avc.encoder',
        presets: {
          medium: { width: 720, height: 1600, fps: 30, bitrate: 4e6 },
        },
      }),
    );
    expect(caps?.presets.medium.width).toBe(720);
    expect(caps?.presets.high.width).toBe(0);
    expect(parseCapabilities('nope')).toBeNull();
  });

  it('converts theme colours to Android colour ints', () => {
    expect(hexToArgb('#FFFFFF')).toBe(-1);
    expect(hexToArgb('#000000')).toBe(-16777216);
    expect(hexToArgb('#E5484D')).toBe(0xffe5484d - 2 ** 32);
    expect(hexToArgb('red')).toBeNull();
  });
});
