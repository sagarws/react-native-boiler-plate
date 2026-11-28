import React, { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import {
  DISTANCE_STEPS,
  EQ_BANDS_HZ,
  PATTERNS,
  SPEAKERS,
  SPEED_STEPS,
} from '../dsp/params';
import { ROOMS } from '../dsp/presets';
import {
  useCaptureRunning,
  usePlayer,
  useStudio,
} from '../hooks/useAudioStudio';
import { studioService } from '../services/studio.service';
import type {
  MovementPattern,
  Quality,
  RoomPreset,
  SourceMode,
  StudioSettings,
} from '../types';
import { SpatialStage, type StageMode } from './SpatialStage';
import { ActionSheet, Chip, ChipRow, Knob, NameDialog, Section } from './ui';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

/** Sound positions (spec A) → azimuth / elevation. */
const POSITIONS: {
  key: string;
  az: number;
  el: number;
  pattern?: MovementPattern;
}[] = [
  { key: 'front', az: 0, el: 0 },
  { key: 'rear', az: 180, el: 0 },
  { key: 'left', az: -90, el: 0 },
  { key: 'right', az: 90, el: 0 },
  { key: 'top', az: 0, el: 60 },
  { key: 'bottom', az: 0, el: -35 },
  { key: 'around', az: 0, el: 0, pattern: 'clockwise' },
];

const ROOM_KEYS: RoomPreset[] = [
  ...(Object.keys(ROOMS) as RoomPreset[]),
  'custom',
];

/** The spatial studio: presets, the stage, and every DSP control. */
export function StudioControls({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const data = useStudio();
  const s = data.settings;
  const player = usePlayer();
  const captureRunning = useCaptureRunning();
  const [mode, setMode] = useState<StageMode>('around');
  const [saveOpen, setSaveOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [presetMenu, setPresetMenu] = useState<string | null>(null);
  const set = (patch: Partial<StudioSettings>) => studioService.update(patch);
  const presets = studioService.presets();
  const menuPreset = presets.find(p => p.id === presetMenu);

  return (
    <View style={{ gap: spacing.lg }}>
      <Section
        title={t('audioStudio.studio.eightD')}
        right={
          <Switch
            value={s.enabled}
            onValueChange={enabled => studioService.update({ enabled }, true)}
            trackColor={{ false: colors.disabled, true: colors.primary }}
            thumbColor={colors.surface}
            accessibilityLabel={t('audioStudio.studio.eightD')}
            testID="studio-enabled"
          />
        }
      >
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('audioStudio.studio.headphones')}
        </Text>
        <ChipRow>
          {presets.map(p => (
            <Chip
              key={p.id}
              label={p.name}
              active={data.presetId === p.id}
              onPress={() => studioService.applyPreset(p.id)}
              testID={`studio-preset-${p.id}`}
            />
          ))}
        </ChipRow>
        <ChipRow>
          <Chip
            label={t('audioStudio.presets.save')}
            icon="plus"
            onPress={() => setSaveOpen(true)}
            testID="studio-preset-save"
          />
          {data.presetId ? (
            <Chip
              label={t('audioStudio.presets.manage')}
              icon="pencil"
              onPress={() => setPresetMenu(data.presetId)}
            />
          ) : null}
          <Chip
            label={t('audioStudio.presets.restore')}
            icon="rotateCcw"
            onPress={() =>
              Alert.alert(
                t('audioStudio.presets.restore'),
                t('audioStudio.presets.restoreBody'),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('audioStudio.presets.restore'),
                    onPress: () => studioService.restoreDefaults(),
                  },
                ],
              )
            }
          />
        </ChipRow>
      </Section>

      <View style={{ gap: spacing.sm }}>
        <ChipRow>
          {(['around', 'distance', 'rotation', 'multi'] as StageMode[]).map(
            m => (
              <Chip
                key={m}
                label={t(`audioStudio.stage.modes.${m}`)}
                active={mode === m}
                onPress={() => setMode(m)}
              />
            ),
          )}
        </ChipRow>
        <SpatialStage
          settings={s}
          active={visible && (player.playing || captureRunning) && s.enabled}
          mode={mode}
          onPlace={(azimuth, distance) =>
            set(
              mode === 'distance'
                ? { distance }
                : {
                    azimuth,
                    distance,
                    pattern:
                      s.pattern === 'clockwise' || s.pattern === 'anticlockwise'
                        ? s.pattern
                        : 'static',
                  },
            )
          }
        />
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {player.playing
            ? t('audioStudio.stage.liveHint')
            : t('audioStudio.stage.idleHint')}
        </Text>
      </View>

      <Section title={t('audioStudio.studio.position')}>
        <ChipRow>
          {POSITIONS.map(p => (
            <Chip
              key={p.key}
              label={t(`audioStudio.positions.${p.key}`)}
              active={
                p.pattern
                  ? s.pattern === p.pattern
                  : s.pattern === 'static' &&
                    Math.abs(s.azimuth - p.az) < 1 &&
                    Math.abs(s.elevation - p.el) < 1
              }
              onPress={() =>
                set({
                  azimuth: p.az,
                  elevation: p.el,
                  pattern: p.pattern ?? 'static',
                })
              }
              testID={`studio-pos-${p.key}`}
            />
          ))}
        </ChipRow>
        <Knob
          label={t('audioStudio.studio.direction')}
          value={s.azimuth}
          min={-180}
          max={180}
          step={5}
          format={v => `${v}°`}
          onChange={azimuth => set({ azimuth })}
        />
        <Knob
          label={t('audioStudio.studio.height')}
          value={s.elevation}
          min={-40}
          max={70}
          step={5}
          format={v => `${v}°`}
          onChange={elevation => set({ elevation })}
        />
        <Knob
          label={t('audioStudio.studio.distance')}
          value={s.distance}
          min={0}
          max={1}
          step={0.01}
          format={v =>
            t(
              `audioStudio.distance.${
                DISTANCE_STEPS.reduce((b, d) =>
                  Math.abs(d.value - v) < Math.abs(b.value - v) ? d : b,
                ).key
              }`,
            )
          }
          onChange={distance => set({ distance })}
          testID="studio-distance"
        />
      </Section>

      <Section title={t('audioStudio.studio.movement')}>
        <ChipRow>
          {PATTERNS.map(p => (
            <Chip
              key={p}
              label={t(`audioStudio.patterns.${p}`)}
              active={s.pattern === p}
              onPress={() => set({ pattern: p })}
              testID={`studio-pattern-${p}`}
            />
          ))}
        </ChipRow>
        <ChipRow>
          {SPEED_STEPS.map(sp => (
            <Chip
              key={sp.key}
              label={t(`audioStudio.speed.${sp.key}`)}
              active={s.rpm === sp.rpm}
              onPress={() => set({ rpm: sp.rpm })}
            />
          ))}
        </ChipRow>
        <Knob
          label={t('audioStudio.studio.rpm')}
          value={s.rpm}
          min={0}
          max={60}
          step={0.5}
          format={v => `${v} RPM`}
          onChange={rpm => set({ rpm })}
          testID="studio-rpm"
        />
        <Knob
          label={t('audioStudio.studio.moveIntensity')}
          value={s.moveIntensity}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={moveIntensity => set({ moveIntensity })}
        />
        <ChipRow>
          {(['single', 'stereoPair', 'vocalBed'] as SourceMode[]).map(m => (
            <Chip
              key={m}
              label={t(`audioStudio.sourceModes.${m}`)}
              active={s.sourceMode === m}
              onPress={() => set({ sourceMode: m })}
            />
          ))}
        </ChipRow>
      </Section>

      <Section title={t('audioStudio.studio.depth')}>
        <Knob
          label={t('audioStudio.studio.roomDepth')}
          value={s.roomDepth}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={roomDepth => set({ roomDepth })}
        />
        <Knob
          label={t('audioStudio.studio.width')}
          value={s.width}
          min={0}
          max={2}
          step={0.05}
          format={pct}
          onChange={width => set({ width })}
        />
        <Knob
          label={t('audioStudio.studio.surround')}
          value={s.surround}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={surround => set({ surround })}
          testID="studio-surround"
        />
        <Knob
          label={t('audioStudio.studio.hrtf')}
          value={s.hrtf}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={hrtf => set({ hrtf })}
        />
        <Knob
          label={t('audioStudio.studio.frontRear')}
          value={s.frontRear}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={frontRear => set({ frontRear })}
        />
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('audioStudio.studio.speakers')}
        </Text>
        <View style={[styles.grid, { gap: spacing.sm }]}>
          {SPEAKERS.map((name, i) => (
            <View key={name} style={styles.half}>
              <Knob
                label={t(`audioStudio.speakerNames.${name}`)}
                value={s.speakers[i] ?? 1}
                min={0}
                max={1.5}
                step={0.05}
                format={pct}
                onChange={v => {
                  const speakers = [...s.speakers];
                  speakers[i] = v;
                  set({ speakers });
                }}
              />
            </View>
          ))}
        </View>
      </Section>

      <Section title={t('audioStudio.studio.reverb')}>
        <ChipRow>
          {ROOM_KEYS.map(room => (
            <Chip
              key={room}
              label={t(`audioStudio.rooms.${room}`)}
              active={s.room === room}
              onPress={() => studioService.setRoom(room)}
              testID={`studio-room-${room}`}
            />
          ))}
        </ChipRow>
        <Knob
          label={t('audioStudio.studio.reverbMix')}
          value={s.reverbMix}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={reverbMix => set({ reverbMix, room: 'custom' })}
        />
        <Knob
          label={t('audioStudio.studio.decay')}
          value={s.reverbDecay}
          min={0.2}
          max={8}
          step={0.1}
          format={v => `${v.toFixed(1)} s`}
          onChange={reverbDecay => set({ reverbDecay, room: 'custom' })}
        />
        <Knob
          label={t('audioStudio.studio.roomSize')}
          value={s.roomSize}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={roomSize => set({ roomSize, room: 'custom' })}
        />
        <Knob
          label={t('audioStudio.studio.damping')}
          value={s.reverbDamp}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={reverbDamp => set({ reverbDamp, room: 'custom' })}
        />
        <Knob
          label={t('audioStudio.studio.predelay')}
          value={s.predelay}
          min={0}
          max={100}
          step={1}
          format={v => `${v} ms`}
          onChange={predelay => set({ predelay, room: 'custom' })}
        />
        <Knob
          label={t('audioStudio.studio.echo')}
          value={s.echo}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={echo => set({ echo })}
        />
      </Section>

      <Section title={t('audioStudio.studio.smoothness')}>
        <Knob
          label={t('audioStudio.studio.smoothing')}
          value={s.smoothing}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={smoothing => set({ smoothing })}
        />
        <Knob
          label={t('audioStudio.studio.harshness')}
          value={s.harshness}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={harshness => set({ harshness })}
        />
        <Knob
          label={t('audioStudio.studio.compressor')}
          value={s.compressor}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={compressor => set({ compressor })}
        />
        <Knob
          label={t('audioStudio.studio.warmth')}
          value={s.warmth}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={warmth => set({ warmth })}
        />
        <Knob
          label={t('audioStudio.studio.clarity')}
          value={s.vocal}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={vocal => set({ vocal })}
        />
        <Knob
          label={t('audioStudio.studio.bassDepth')}
          value={s.bass}
          min={0}
          max={12}
          step={0.5}
          format={db}
          onChange={bass => set({ bass })}
        />
      </Section>

      <Section title={t('audioStudio.studio.quality')}>
        <ChipRow>
          {([0, 1, 2] as Quality[]).map(q => (
            <Chip
              key={q}
              label={t(`audioStudio.quality.${q}`)}
              active={s.quality === q}
              onPress={() => studioService.update({ quality: q }, true)}
              testID={`studio-quality-${q}`}
            />
          ))}
        </ChipRow>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t(`audioStudio.quality.hint${s.quality}`)}
        </Text>
      </Section>

      <NameDialog
        visible={saveOpen}
        title={t('audioStudio.presets.save')}
        onClose={() => setSaveOpen(false)}
        onSubmit={name => studioService.saveAsPreset(name)}
      />
      <NameDialog
        visible={!!renameId}
        title={t('audioStudio.presets.rename')}
        initial={presets.find(p => p.id === renameId)?.name ?? ''}
        onClose={() => setRenameId(null)}
        onSubmit={name =>
          renameId && studioService.renamePreset(renameId, name)
        }
      />
      <ActionSheet
        visible={!!menuPreset}
        title={menuPreset?.name ?? ''}
        onClose={() => setPresetMenu(null)}
        actions={
          menuPreset
            ? [
                {
                  label: t('audioStudio.presets.overwrite'),
                  icon: 'check',
                  onPress: () => studioService.updatePreset(menuPreset.id),
                },
                {
                  label: t('audioStudio.presets.rename'),
                  icon: 'pencil',
                  onPress: () => setRenameId(menuPreset.id),
                },
                {
                  label: menuPreset.builtIn
                    ? t('audioStudio.presets.reset')
                    : t('audioStudio.presets.delete'),
                  icon: menuPreset.builtIn ? 'rotateCcw' : 'x',
                  destructive: !menuPreset.builtIn,
                  onPress: () => studioService.deletePreset(menuPreset.id),
                },
              ]
            : []
        }
      />
    </View>
  );
}

/** Equalizer: 10 bands, tone, dynamics, profiles. */
export function EqualizerPanel() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const data = useStudio();
  const s = data.settings;
  const [saveOpen, setSaveOpen] = useState(false);
  const profiles = studioService.eqProfiles();
  const set = (patch: Partial<StudioSettings>) =>
    studioService.update(patch, true);
  const custom = profiles.find(p => p.id === data.eqProfileId && !p.builtIn);

  return (
    <View style={{ gap: spacing.lg }}>
      <Section
        title={t('audioStudio.eq.title')}
        right={
          <Switch
            value={s.eqEnabled}
            onValueChange={eqEnabled => set({ eqEnabled })}
            trackColor={{ false: colors.disabled, true: colors.primary }}
            thumbColor={colors.surface}
            accessibilityLabel={t('audioStudio.eq.title')}
            testID="studio-eq-enabled"
          />
        }
      >
        <ChipRow>
          {profiles.map(p => (
            <Chip
              key={p.id}
              label={p.name}
              active={data.eqProfileId === p.id}
              onPress={() => studioService.applyEq(p.id)}
              testID={`studio-eq-${p.id}`}
            />
          ))}
        </ChipRow>
        <ChipRow>
          <Chip
            label={t('audioStudio.eq.save')}
            icon="plus"
            onPress={() => setSaveOpen(true)}
          />
          {custom ? (
            <Chip
              label={t('audioStudio.presets.delete')}
              icon="x"
              onPress={() => studioService.deleteEqProfile(custom.id)}
            />
          ) : null}
        </ChipRow>
        <Knob
          label={t('audioStudio.eq.preamp')}
          value={s.preamp}
          min={-12}
          max={6}
          step={0.5}
          format={db}
          onChange={preamp => set({ preamp })}
        />
        {EQ_BANDS_HZ.map((hz, i) => (
          <Knob
            key={hz}
            label={hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`}
            value={s.eq[i] ?? 0}
            min={-12}
            max={12}
            step={0.5}
            format={db}
            onChange={v => studioService.setEqBand(i, v)}
            testID={`studio-eq-band-${i}`}
          />
        ))}
      </Section>
      <Section title={t('audioStudio.eq.tone')}>
        <Knob
          label={t('audioStudio.eq.bass')}
          value={s.bass}
          min={0}
          max={12}
          step={0.5}
          format={db}
          onChange={bass => set({ bass })}
        />
        <Knob
          label={t('audioStudio.eq.treble')}
          value={s.treble}
          min={-12}
          max={12}
          step={0.5}
          format={db}
          onChange={treble => set({ treble })}
        />
        <Knob
          label={t('audioStudio.eq.vocal')}
          value={s.vocal}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={vocal => set({ vocal })}
        />
        <Knob
          label={t('audioStudio.studio.width')}
          value={s.width}
          min={0}
          max={2}
          step={0.05}
          format={pct}
          onChange={width => set({ width })}
        />
        <Knob
          label={t('audioStudio.eq.loudness')}
          value={s.loudness}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={loudness => set({ loudness })}
        />
      </Section>
      <Section title={t('audioStudio.eq.dynamics')}>
        <Knob
          label={t('audioStudio.studio.compressor')}
          value={s.compressor}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={compressor => set({ compressor })}
        />
        <Knob
          label={t('audioStudio.eq.output')}
          value={s.output}
          min={-12}
          max={6}
          step={0.5}
          format={db}
          onChange={output => set({ output })}
        />
        <View style={styles.row}>
          <Text
            style={[
              typography.body,
              styles.flex,
              { color: colors.textPrimary },
            ]}
          >
            {t('audioStudio.eq.limiter')}
          </Text>
          <Switch
            value={s.limiter}
            onValueChange={limiter => set({ limiter })}
            trackColor={{ false: colors.disabled, true: colors.primary }}
            thumbColor={colors.surface}
            accessibilityLabel={t('audioStudio.eq.limiter')}
          />
        </View>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('audioStudio.eq.limiterHint')}
        </Text>
      </Section>
      <NameDialog
        visible={saveOpen}
        title={t('audioStudio.eq.save')}
        onClose={() => setSaveOpen(false)}
        onSubmit={name => studioService.saveEqProfile(name)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  half: { width: '47%' },
});
