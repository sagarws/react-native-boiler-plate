import React from 'react';
import { DeviceEventEmitter } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import YouTubeDownloadScreen from '../screens/YouTubeDownloadScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
  useIsFocused: () => true,
}));
jest.mock('@/specs/NativeYouTubeDownloader', () => ({
  __esModule: true,
  default: {
    getVideoInfo: jest.fn(),
    startDownload: jest.fn(),
    cancelDownload: jest.fn(),
    getActiveDownload: jest.fn(),
    listDownloads: jest.fn(),
    removeDownload: jest.fn(),
    openDownload: jest.fn(),
    shareDownload: jest.fn(),
  },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeYouTubeDownloader',
).default;

const DETAILS = {
  id: 'X7pNbK8ATiE',
  url: 'https://www.youtube.com/watch?v=X7pNbK8ATiE',
  title: 'Rise of BMW',
  author: 'Channel',
  durationSec: 1048,
  thumbnail: '',
  video: [
    {
      id: 'v313_a251',
      kind: 'video',
      label: '2160p',
      height: 2160,
      ext: 'webm',
      codec: 'VP9',
      sizeBytes: 900e6,
    },
    {
      id: 'v137_a140',
      kind: 'video',
      label: '1080p',
      height: 1080,
      ext: 'mp4',
      codec: 'H.264',
      sizeBytes: 270e6,
    },
  ],
  audio: [
    {
      id: 'a251',
      kind: 'audio',
      label: '160 kbps',
      ext: 'opus',
      codec: 'Opus',
      sizeBytes: 18e6,
    },
    {
      id: 'a140',
      kind: 'audio',
      label: '128 kbps',
      ext: 'm4a',
      codec: 'AAC',
      sizeBytes: 16e6,
    },
  ],
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
let renderer: Renderer | undefined;
async function render() {
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<YouTubeDownloadScreen />);
  });
  return renderer!;
}
const byId = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];
const has = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const allText = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => [n.props.children].flat().join(''))
    .join('\n');
const act = (fn: () => unknown) =>
  ReactTestRenderer.act(async () => {
    await fn();
  });

async function lookUp(
  r: Renderer,
  link = 'https://youtu.be/X7pNbK8ATiE?si=abc',
) {
  await act(() => byId(r, 'yt-link').props.onChangeText(link));
  await act(() => byId(r, 'yt-fetch').props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  native.listDownloads.mockResolvedValue('[]');
  native.getActiveDownload.mockResolvedValue('');
  native.getVideoInfo.mockResolvedValue(JSON.stringify(DETAILS));
  native.startDownload.mockResolvedValue('job-1');
});
afterEach(() => {
  ReactTestRenderer.act(() => renderer?.unmount());
});

describe('YouTubeDownloadScreen', () => {
  it('shows the empty downloads list', async () => {
    const r = await render();
    expect(has(r, 'yt-empty')).toBe(true);
  });

  it('rejects a non-YouTube link without calling native', async () => {
    const r = await render();
    await lookUp(r, 'https://vimeo.com/1');
    expect(native.getVideoInfo).not.toHaveBeenCalled();
    expect(has(r, 'yt-lookup-error')).toBe(true);
  });

  it('looks up the canonical URL and preselects 1080p', async () => {
    const r = await render();
    await lookUp(r);
    expect(native.getVideoInfo).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=X7pNbK8ATiE',
    );
    expect(allText(r)).toContain('Rise of BMW');
    expect(byId(r, 'yt-quality').props.value).toBe('v137_a140');
  });

  it('downloads the chosen video quality', async () => {
    const r = await render();
    await lookUp(r);
    await act(() => byId(r, 'yt-quality').props.onChange('v313_a251'));
    await act(() => byId(r, 'yt-download').props.onPress());
    expect(native.startDownload).toHaveBeenCalledWith(DETAILS.url, 'v313_a251');
    expect(has(r, 'yt-active')).toBe(true);
  });

  it('switches to audio only and downloads the best audio', async () => {
    const r = await render();
    await lookUp(r);
    await act(() => byId(r, 'yt-mode').props.onChange('audio'));
    expect(byId(r, 'yt-quality').props.value).toBe('a251');
    await act(() => byId(r, 'yt-download').props.onPress());
    expect(native.startDownload).toHaveBeenCalledWith(DETAILS.url, 'a251');
  });

  it('shows a native lookup error by code', async () => {
    native.getVideoInfo.mockRejectedValue({ code: 'private' });
    const r = await render();
    await lookUp(r);
    expect(allText(r)).toContain('This video is private.');
  });

  it('follows progress and completion events', async () => {
    const r = await render();
    await act(() =>
      DeviceEventEmitter.emit('YouTubeDownloadEvent', {
        type: 'progress',
        body: JSON.stringify({
          id: 'j',
          title: 'Rise of BMW',
          phase: 'downloading',
          fraction: 0.42,
          label: '1080p',
        }),
      }),
    );
    expect(allText(r)).toContain('42%');
    await act(() => byId(r, 'yt-cancel').props.onPress());
    expect(native.cancelDownload).toHaveBeenCalled();

    await act(() =>
      DeviceEventEmitter.emit('YouTubeDownloadEvent', {
        type: 'completed',
        body: JSON.stringify({
          entry: {
            id: 'e1',
            title: 'Rise of BMW',
            kind: 'video',
            label: '1080p',
            name: 'Rise (1080p).mp4',
            sizeBytes: 1000,
            createdAt: 1,
          },
        }),
      }),
    );
    expect(has(r, 'yt-active')).toBe(false);
    expect(has(r, 'yt-done')).toBe(true);
    expect(has(r, 'yt-entry-e1')).toBe(true);
  });

  it('shows a failed download', async () => {
    const r = await render();
    await act(() =>
      DeviceEventEmitter.emit('YouTubeDownloadEvent', {
        type: 'failed',
        body: JSON.stringify({ id: 'j', code: 'storage_full' }),
      }),
    );
    expect(allText(r)).toContain('Not enough storage space');
  });
});
