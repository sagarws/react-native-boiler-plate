import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ChoiceList,
  ExpandableCard,
  ListRow,
  Notice,
  SegmentedControl,
  TextField,
} from '@/shared/components';
import { useTheme } from '@/theme';
import {
  setRecorderBubble,
  useRecorderConfig,
  useRecorderStatus,
} from '../hooks/useRecorder';
import { recorderNative } from '../services/recorder.service';
import {
  audioBitrate,
  estimateBytesPerHour,
  formatBytes,
  isCapturing,
  parseSegmentMinutes,
} from '../services/recordings';
import {
  AUDIO_PRESETS,
  AUDIO_SOURCES,
  RECORDER_MODES,
  SEGMENT_PRESETS,
  VIDEO_PRESETS,
  type RecorderConfig,
  type VideoCapabilities,
} from '../recorder.types';
import { LabeledSlider, OptionChips, SwitchRow } from './RecorderRows';
import { RecordingStorageSection } from './RecordingStorageSection';

type Section = 'button' | 'storage' | 'video' | 'audio' | 'segments' | 'other';

const MODE_ICONS = {
  screenshot: 'camera',
  screen: 'monitor',
  voice: 'audioLines',
  screen_voice: 'layers',
} as const;

/**
 * Settings → Recording (also opened from Utility → Screen Recorder): the
 * recording button, save folders, video/audio quality, automatic segments
 * and other options. Everything is stored natively so the floating button
 * works while the app is closed; changes apply from the next recording.
 */
export function RecordingSettings() {
  const { t } = useTranslation();
  const { colors, typography, spacing, scheme } = useTheme();
  const { config, update, error } = useRecorderConfig();
  const { status, refresh } = useRecorderStatus();
  const [open, setOpen] = useState<Section | null>(null);
  const [caps, setCaps] = useState<VideoCapabilities | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    recorderNative.syncTheme(scheme === 'dark', colors.primary);
  }, [scheme, colors.primary]);

  // Encoder limits depend on the custom values; re-check when they change.
  const custom = config.customVideo;
  useEffect(() => {
    let cancelled = false;
    recorderNative
      .capabilities()
      .then(c => !cancelled && setCaps(c))
      .catch(() => !cancelled && setCaps(null));
    return () => {
      cancelled = true;
    };
  }, [custom.height, custom.fps, custom.bitrate]);

  const section = (key: Section) => ({
    expanded: open === key,
    onToggle: () => setOpen(c => (c === key ? null : key)),
  });
  const onOff = (v: boolean) => (v ? t('common.on') : t('common.off'));
  const set = (patch: Partial<RecorderConfig>) => {
    void update(patch);
  };

  const toggleBubble = async (on: boolean) => {
    if (!on && isCapturing(status.state)) {
      // Turning the button off never stops a recording silently.
      Alert.alert(
        t('recorder.hideWhileRecordingTitle'),
        t('recorder.hideWhileRecording'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('recorder.hideButton'),
            onPress: () => {
              void setRecorderBubble(false).then(refresh);
            },
          },
        ],
      );
      return;
    }
    const outcome = await setRecorderBubble(on);
    if (outcome === 'overlay_permission') setNotice('overlay');
    else if (outcome === 'error') setNotice('error');
    else setNotice(null);
    await refresh();
    set({ bubbleEnabled: on && outcome === 'shown' });
  };

  const plan = caps?.presets[config.videoPreset];
  const perHour = plan
    ? estimateBytesPerHour(plan.bitrate, audioBitrate(config))
    : 0;

  const applyCustomMinutes = () => {
    const n = parseSegmentMinutes(customText);
    if (n === null) {
      setCustomError(t('recorder.customMinutesError'));
      return;
    }
    setCustomError(null);
    set({ segmentMinutes: n });
  };

  return (
    <View style={{ gap: spacing.md }} testID="recording-settings">
      {!recorderNative.available() ? (
        <Notice tone="warning" message={t('recorder.unsupported')} />
      ) : null}
      {error ? (
        <Notice tone="error" message={t('recorder.settingsSaveFailed')} />
      ) : null}
      {notice === 'overlay' ? (
        <Notice
          tone="warning"
          title={t('recorder.overlayTitle')}
          message={t('recorder.overlayBody')}
          action={{
            label: t('recorder.openOverlaySettings'),
            onPress: recorderNative.openOverlaySettings,
          }}
          onDismiss={() => setNotice(null)}
          testID="rec-overlay-notice"
        />
      ) : notice === 'error' ? (
        <Notice
          tone="error"
          message={t('recorder.toggleFailed')}
          onDismiss={() => setNotice(null)}
        />
      ) : null}

      {/* A. Floating button */}
      <ExpandableCard
        title={t('recorder.sectionButton')}
        summary={t('recorder.summaryButton', {
          state: onOff(status.bubbleShown),
          mode: t(`recorder.mode_${config.mode}`),
        })}
        icon="pointer"
        footer={t('recorder.buttonFooter')}
        testID="rec-section-button"
        {...section('button')}
      >
        <SwitchRow
          icon="power"
          title={t('recorder.enableButton')}
          subtitle={t('recorder.enableButtonHint')}
          value={status.bubbleShown}
          onChange={on => {
            void toggleBubble(on);
          }}
          testID="rec-enable-button"
        />
        <View style={{ padding: spacing.lg }}>
          <ChoiceList
            accessibilityLabel={t('recorder.defaultMode')}
            testID="rec-mode"
            value={config.mode}
            onChange={mode => set({ mode })}
            choices={RECORDER_MODES.map(m => ({
              value: m,
              title: t(`recorder.mode_${m}`),
              description: t(`recorder.modeDesc_${m}`),
              icon: MODE_ICONS[m],
            }))}
          />
        </View>
        <SwitchRow
          divider
          icon="mousePointerClick"
          title={t('recorder.longPressMenu')}
          subtitle={t('recorder.longPressMenuHint')}
          value={config.longPressMenu}
          onChange={longPressMenu => set({ longPressMenu })}
        />
        <SwitchRow
          divider
          icon="slidersHorizontal"
          title={t('recorder.showControls')}
          subtitle={t('recorder.showControlsHint')}
          value={config.showControls}
          onChange={showControls => set({ showControls })}
        />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <LabeledSlider
            label={t('recorder.previewSeconds')}
            valueText={t('recorder.seconds', { count: config.previewSeconds })}
            value={config.previewSeconds}
            min={2}
            max={15}
            step={1}
            onChange={previewSeconds => set({ previewSeconds })}
            testID="rec-preview-seconds"
          />
        </View>
        <SwitchRow
          divider
          icon="download"
          title={t('recorder.autoSaveScreenshot')}
          subtitle={t('recorder.autoSaveScreenshotHint')}
          value={config.autoSaveScreenshot}
          onChange={autoSaveScreenshot => set({ autoSaveScreenshot })}
        />
        <SwitchRow
          divider
          icon="shieldCheck"
          title={t('recorder.keepCapture')}
          subtitle={t('recorder.keepCaptureHint')}
          value={config.keepCaptureSession}
          onChange={keepCaptureSession => set({ keepCaptureSession })}
        />
        <ListRow
          divider
          icon="rotateCcw"
          title={t('recorder.resetPosition')}
          onPress={() => {
            recorderNative.resetBubblePosition();
            setNotice(null);
          }}
          testID="rec-reset-position"
        />
      </ExpandableCard>

      {/* B. Storage */}
      <RecordingStorageSection {...section('storage')} />

      {/* C. Video quality */}
      <ExpandableCard
        title={t('recorder.sectionVideo')}
        summary={
          plan
            ? t('recorder.summaryVideo', {
                preset: t(`recorder.videoPreset_${config.videoPreset}`),
                width: plan.width,
                height: plan.height,
                fps: plan.fps,
              })
            : t(`recorder.videoPreset_${config.videoPreset}`)
        }
        icon="monitor"
        footer={t('recorder.videoFooter')}
        padded
        testID="rec-section-video"
        {...section('video')}
      >
        <View style={{ gap: spacing.md }}>
          <SegmentedControl
            accessibilityLabel={t('recorder.videoQuality')}
            options={VIDEO_PRESETS.map(p => ({
              value: p,
              label: t(`recorder.videoPreset_${p}`),
            }))}
            value={config.videoPreset}
            onChange={videoPreset => set({ videoPreset })}
            testID="rec-video-preset"
          />
          {config.videoPreset === 'custom' ? (
            <>
              <OptionChips
                label={t('recorder.resolution')}
                options={[480, 720, 1080, 1440].map(h => ({
                  value: h,
                  label: `${h}p`,
                }))}
                value={config.customVideo.height}
                onChange={height =>
                  set({ customVideo: { ...config.customVideo, height } })
                }
                testID="rec-custom-height"
              />
              <OptionChips
                label={t('recorder.frameRate')}
                options={[15, 24, 30, 60].map(f => ({
                  value: f,
                  label: t('recorder.fps', { fps: f }),
                }))}
                value={config.customVideo.fps}
                onChange={fps =>
                  set({ customVideo: { ...config.customVideo, fps } })
                }
                testID="rec-custom-fps"
              />
              <LabeledSlider
                label={t('recorder.videoBitrate')}
                valueText={t('recorder.mbps', {
                  value: (config.customVideo.bitrate / 1_000_000).toFixed(1),
                })}
                value={config.customVideo.bitrate / 1_000_000}
                min={1}
                max={20}
                step={0.5}
                onChange={mbps =>
                  set({
                    customVideo: {
                      ...config.customVideo,
                      bitrate: Math.round(mbps * 1_000_000),
                    },
                  })
                }
              />
            </>
          ) : null}
          {plan ? (
            <Text
              style={[typography.caption, { color: colors.textSecondary }]}
              testID="rec-video-applied"
            >
              {t('recorder.videoApplied', {
                width: plan.width,
                height: plan.height,
                fps: plan.fps,
                mbps: (plan.bitrate / 1_000_000).toFixed(1),
                perHour: formatBytes(perHour),
              })}
            </Text>
          ) : null}
        </View>
      </ExpandableCard>

      {/* D. Audio */}
      <ExpandableCard
        title={t('recorder.sectionAudio')}
        summary={`${t(`recorder.audioSource_${config.audioSource}`)} · ${t(
          `recorder.audioPreset_${config.audioPreset}`,
        )}`}
        icon="audioLines"
        footer={t('recorder.audioFooter')}
        padded
        testID="rec-section-audio"
        {...section('audio')}
      >
        <View style={{ gap: spacing.md }}>
          {!status.systemAudioSupported && status.supported ? (
            <Notice tone="warning" message={t('recorder.systemAudioOld')} />
          ) : null}
          <ChoiceList
            accessibilityLabel={t('recorder.audioSource')}
            testID="rec-audio-source"
            value={config.audioSource}
            onChange={audioSource => set({ audioSource })}
            choices={AUDIO_SOURCES.map(a => ({
              value: a,
              title: t(`recorder.audioSource_${a}`),
              description: t(`recorder.audioSourceDesc_${a}`),
            }))}
          />
          <SegmentedControl
            accessibilityLabel={t('recorder.audioQuality')}
            options={AUDIO_PRESETS.map(p => ({
              value: p,
              label: t(`recorder.audioPreset_${p}`),
            }))}
            value={config.audioPreset}
            onChange={audioPreset => set({ audioPreset })}
            testID="rec-audio-preset"
          />
          {config.audioPreset === 'custom' ? (
            <>
              <OptionChips
                label={t('recorder.sampleRate')}
                options={[22_050, 44_100, 48_000].map(r => ({
                  value: r,
                  label: t('recorder.khz', { value: (r / 1000).toFixed(1) }),
                }))}
                value={config.customAudio.sampleRate}
                onChange={sampleRate =>
                  set({ customAudio: { ...config.customAudio, sampleRate } })
                }
              />
              <OptionChips
                label={t('recorder.audioBitrate')}
                options={[64_000, 96_000, 128_000, 192_000, 256_000].map(b => ({
                  value: b,
                  label: t('recorder.kbps', { value: b / 1000 }),
                }))}
                value={config.customAudio.bitrate}
                onChange={bitrate =>
                  set({ customAudio: { ...config.customAudio, bitrate } })
                }
              />
              <OptionChips
                label={t('recorder.channels')}
                options={[
                  { value: 1, label: t('recorder.mono') },
                  { value: 2, label: t('recorder.stereo') },
                ]}
                value={config.customAudio.channels}
                onChange={channels =>
                  set({ customAudio: { ...config.customAudio, channels } })
                }
              />
            </>
          ) : null}
        </View>
      </ExpandableCard>

      {/* E. Segments */}
      <ExpandableCard
        title={t('recorder.sectionSegments')}
        summary={
          config.segmentEnabled
            ? t('recorder.summarySegments', { count: config.segmentMinutes })
            : t('common.off')
        }
        icon="layers"
        footer={t('recorder.segmentsFooter')}
        testID="rec-section-segments"
        {...section('segments')}
      >
        <SwitchRow
          icon="layers"
          title={t('recorder.segmentEnabled')}
          subtitle={t('recorder.segmentEnabledHint')}
          value={config.segmentEnabled}
          onChange={segmentEnabled => set({ segmentEnabled })}
          testID="rec-segment-enabled"
        />
        {config.segmentEnabled ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <OptionChips
              label={t('recorder.segmentMinutes')}
              options={SEGMENT_PRESETS.map(m => ({
                value: m,
                label: t('recorder.minutes', { count: m }),
              }))}
              value={config.segmentMinutes}
              onChange={segmentMinutes => {
                setCustomError(null);
                set({ segmentMinutes });
              }}
              testID="rec-segment-minutes"
            />
            <TextField
              label={t('recorder.customMinutes')}
              placeholder={String(config.segmentMinutes)}
              keyboardType="number-pad"
              value={customText}
              onChangeText={setCustomText}
              onSubmitEditing={applyCustomMinutes}
              onBlur={() => {
                if (customText.trim()) applyCustomMinutes();
              }}
              error={customError}
              testID="rec-custom-minutes"
            />
          </View>
        ) : null}
        <SwitchRow
          divider
          icon="link"
          title={t('recorder.autoMerge')}
          subtitle={t('recorder.autoMergeHint')}
          value={config.autoMerge}
          onChange={autoMerge => set({ autoMerge })}
        />
        <SwitchRow
          divider
          icon="folder"
          title={t('recorder.keepSegments')}
          subtitle={t('recorder.keepSegmentsHint')}
          value={config.keepSegments}
          onChange={keepSegments => set({ keepSegments })}
        />
      </ExpandableCard>

      {/* F. Other */}
      <ExpandableCard
        title={t('recorder.sectionOther')}
        summary={t('recorder.summaryOther', {
          mb: config.storageWarningMb,
        })}
        icon="settings"
        testID="rec-section-other"
        {...section('other')}
      >
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <OptionChips
            label={t('recorder.storageWarning')}
            options={[250, 500, 1000, 2000].map(mb => ({
              value: mb,
              label: t('recorder.mb', { value: mb }),
            }))}
            value={config.storageWarningMb}
            onChange={storageWarningMb => set({ storageWarningMb })}
          />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('recorder.storageWarningHint')}
          </Text>
        </View>
        <SwitchRow
          divider
          icon="sun"
          title={t('recorder.keepScreenOn')}
          subtitle={t('recorder.keepScreenOnHint')}
          value={config.keepScreenOn}
          onChange={keepScreenOn => set({ keepScreenOn })}
        />
        <ListRow
          divider
          icon="bell"
          title={t('recorder.notifications')}
          subtitle={
            status.notifications
              ? t('recorder.notificationsOn')
              : t('recorder.notificationsOff')
          }
        />
        <ListRow
          divider
          icon="fileText"
          title={t('recorder.fileNames')}
          subtitle={t('recorder.fileNamesHint')}
        />
      </ExpandableCard>
    </View>
  );
}
