import {
  canonicalYouTubeUrl,
  errorKey,
  parseActive,
  parseDownloadEvent,
  parseEntries,
  parseVideoDetails,
  youTubeVideoId,
} from '../services/youtube';
import { defaultOption } from '../hooks/useYouTubeDownloader';
import type { DownloadOption } from '../youtube.types';

describe('youTubeVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=X7pNbK8ATiE', 'X7pNbK8ATiE'],
    ['https://youtu.be/X7pNbK8ATiE?si=OKvnE3P4wCJpIOEy', 'X7pNbK8ATiE'],
    ['youtu.be/X7pNbK8ATiE', 'X7pNbK8ATiE'],
    ['https://m.youtube.com/watch?v=X7pNbK8ATiE&t=30s', 'X7pNbK8ATiE'],
    ['https://www.youtube.com/shorts/abcdefghijk', 'abcdefghijk'],
    ['https://www.youtube.com/live/abcdefghijk?feature=share', 'abcdefghijk'],
    ['https://music.youtube.com/watch?v=X7pNbK8ATiE', 'X7pNbK8ATiE'],
    ['  https://www.youtube.com/embed/X7pNbK8ATiE  ', 'X7pNbK8ATiE'],
  ])('reads %s', (input, id) => {
    expect(youTubeVideoId(input)).toBe(id);
  });

  it.each([
    '',
    'hello',
    'https://vimeo.com/123456',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UC123',
    'https://evil.com/watch?v=X7pNbK8ATiE',
    'https://youtube.com.evil.com/watch?v=X7pNbK8ATiE',
  ])('rejects %p', input => {
    expect(youTubeVideoId(input)).toBeNull();
  });

  it('builds the canonical watch URL', () => {
    expect(canonicalYouTubeUrl('https://youtu.be/X7pNbK8ATiE?si=x')).toBe(
      'https://www.youtube.com/watch?v=X7pNbK8ATiE',
    );
    expect(canonicalYouTubeUrl('nope')).toBeNull();
  });
});

const option = (o: Partial<DownloadOption>) => ({
  id: 'v137_a140',
  kind: 'video',
  label: '1080p',
  height: 1080,
  fps: 30,
  ext: 'mp4',
  codec: 'H.264',
  bitrateKbps: 4400,
  sizeBytes: 270_000_000,
  ...o,
});

describe('parseVideoDetails', () => {
  it('keeps valid options and drops broken ones', () => {
    const details = parseVideoDetails(
      JSON.stringify({
        id: 'X7pNbK8ATiE',
        url: 'https://www.youtube.com/watch?v=X7pNbK8ATiE',
        title: 'Title',
        author: 'Channel',
        durationSec: 1048,
        thumbnail: 'https://i.ytimg.com/x.jpg',
        video: [option({}), { label: 'no id' }, 'junk'],
        audio: [option({ id: 'a140', kind: 'audio', label: '128 kbps' })],
      }),
    );
    expect(details?.video).toHaveLength(1);
    expect(details?.audio[0].kind).toBe('audio');
    expect(details?.durationSec).toBe(1048);
  });

  it('returns null for bad JSON, no id, or no options', () => {
    expect(parseVideoDetails('{')).toBeNull();
    expect(
      parseVideoDetails(JSON.stringify({ video: [option({})] })),
    ).toBeNull();
    expect(
      parseVideoDetails(JSON.stringify({ id: 'x', video: [], audio: [] })),
    ).toBeNull();
  });

  it('cleans bad numbers', () => {
    const d = parseVideoDetails(
      JSON.stringify({
        id: 'x',
        durationSec: -5,
        video: [option({ sizeBytes: NaN as unknown as number })],
      }),
    );
    expect(d?.durationSec).toBe(0);
    expect(d?.video[0].sizeBytes).toBe(0);
  });
});

describe('download state and events', () => {
  it('parses the active download (empty string = idle)', () => {
    expect(parseActive('')).toBeNull();
    expect(
      parseActive(
        JSON.stringify({
          id: 'j1',
          phase: 'merging',
          fraction: 1.4,
          label: '4K',
        }),
      ),
    ).toEqual({
      id: 'j1',
      title: '',
      label: '4K',
      phase: 'merging',
      fraction: 1,
    });
    expect(
      parseActive(JSON.stringify({ id: 'j', phase: 'weird' }))?.phase,
    ).toBe('fetching');
  });

  it('sorts entries newest first and drops bad ones', () => {
    const list = parseEntries(
      JSON.stringify([
        { id: 'old', createdAt: 1, kind: 'audio' },
        { nope: true },
        { id: 'new', createdAt: 5 },
      ]),
    );
    expect(list.map(e => e.id)).toEqual(['new', 'old']);
    expect(list[1].kind).toBe('audio');
    expect(parseEntries('not json')).toEqual([]);
  });

  it('parses native events', () => {
    expect(
      parseDownloadEvent(
        'progress',
        JSON.stringify({ id: 'j', phase: 'downloading', fraction: 0.5 }),
      ),
    ).toMatchObject({ type: 'progress', active: { fraction: 0.5 } });
    expect(
      parseDownloadEvent('completed', JSON.stringify({ entry: { id: 'e1' } })),
    ).toMatchObject({ type: 'completed', entry: { id: 'e1' } });
    expect(parseDownloadEvent('failed', '{"id":"j"}')).toEqual({
      type: 'failed',
      id: 'j',
      code: 'download_failed',
    });
    expect(parseDownloadEvent('cancelled', '{"id":"j"}')).toEqual({
      type: 'cancelled',
      id: 'j',
    });
    expect(parseDownloadEvent('other', '{}')).toBeNull();
    expect(parseDownloadEvent('progress', '{bad')).toBeNull();
  });
});

describe('errorKey', () => {
  it('maps known codes and falls back to generic', () => {
    expect(errorKey('private')).toBe('utility.yt.error_private');
    expect(errorKey('something_new')).toBe('utility.yt.error_generic');
  });
});

describe('defaultOption', () => {
  it('prefers 1080p, else the first (best) option', () => {
    const list = [
      option({ id: '4k', height: 2160 }),
      option({ id: 'hd', height: 1080 }),
    ] as DownloadOption[];
    expect(defaultOption(list)).toBe('hd');
    expect(defaultOption([list[0]])).toBe('4k');
    expect(defaultOption([])).toBeNull();
    expect(
      defaultOption([
        option({ id: 'a', kind: 'audio', height: 0 }),
      ] as DownloadOption[]),
    ).toBe('a');
  });
});
