import {
  cleanSettings,
  liveCameraSettingsStore,
  normaliseServerUrl,
} from '../store/liveCameraSettings.store';
import { maxBitrate, qualityOf } from '../services/publisher';
import { formatDuration } from '../components/LiveCameraCards';

describe('live camera settings', () => {
  beforeEach(() => liveCameraSettingsStore.resetCacheForTest());

  it('defaults to 720p, 24 FPS, no audio, public', () => {
    const s = cleanSettings(null);
    expect(s).toMatchObject({
      resolution: '720p',
      fps: 24,
      audio: false,
      access: 'public',
      facing: 'back',
    });
  });

  it('drops invalid values and caps viewers', () => {
    const s = cleanSettings({
      resolution: '4k',
      fps: 60,
      maxViewers: 999,
      title: `  ${'x'.repeat(200)} `,
    });
    expect(s.resolution).toBe('720p');
    expect(s.fps).toBe(24);
    expect(s.maxViewers).toBe(50);
    expect(s.title).toHaveLength(80);
  });

  it('accepts only bare https?://host[:port] server URLs', () => {
    expect(normaliseServerUrl(' https://1-2-3-4.sslip.io/ ')).toBe(
      'https://1-2-3-4.sslip.io',
    );
    expect(normaliseServerUrl('http://10.0.0.2:8080')).toBe(
      'http://10.0.0.2:8080',
    );
    expect(normaliseServerUrl('ftp://x')).toBe('');
    expect(normaliseServerUrl('https://x/path')).toBe('');
  });

  it('persists updates', () => {
    liveCameraSettingsStore.update({ resolution: '1080p', fps: 30 });
    liveCameraSettingsStore.resetCacheForTest();
    expect(liveCameraSettingsStore.read()).toMatchObject({
      resolution: '1080p',
      fps: 30,
    });
  });
});

describe('publisher helpers', () => {
  it('scales the bitrate ceiling with resolution and frame rate', () => {
    expect(maxBitrate('720p', 30)).toBe(2_000_000);
    expect(maxBitrate('720p', 24)).toBe(1_600_000);
    expect(maxBitrate('480p', 15)).toBe(600_000);
    expect(maxBitrate('1080p', 30)).toBeGreaterThan(maxBitrate('720p', 30));
  });

  it('grades the connection', () => {
    expect(qualityOf(24, 24, 80, false)).toBe('good');
    // Dark room: the camera slows down, the network is fine.
    expect(qualityOf(10, 24, 80, false)).toBe('good');
    expect(qualityOf(15, 24, 300, false)).toBe('fair');
    expect(qualityOf(15, 24, 100, true)).toBe('fair');
    expect(qualityOf(5, 24, 100, true)).toBe('poor');
    expect(qualityOf(24, 24, 900, false)).toBe('poor');
    expect(qualityOf(0, 24, null, false)).toBe('unknown');
  });

  it('formats durations', () => {
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
