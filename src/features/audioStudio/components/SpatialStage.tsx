import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import { SPEAKERS, SPEAKER_POSITIONS } from '../dsp/params';
import { useDspLive } from '../hooks/useAudioStudio';
import type { StudioSettings } from '../types';

/*
 * The virtual studio, seen from slightly above: the listener in the centre,
 * eight virtual speakers around, and the sound source(s). While music plays
 * the source is drawn where the ENGINE currently renders it (polled), so what
 * you see is what you hear. Drag anywhere to place the sound (direction =
 * angle from the listener, distance = how far from the centre).
 *
 * Cheap to draw: plain Views moved with native-driver transforms; nothing
 * animates while the screen is hidden.
 */

export type StageMode = 'around' | 'distance' | 'rotation' | 'multi';

const STUDIO_BG = '#0d1017';
const RING = 'rgba(140,160,255,0.18)';
const ACCENT = '#8b7bff';
const SOURCE = '#ff6ad5';
const TILT = 0.62; // vertical squash = looking at the floor from above

/** Top-down position → stage pixels (front at the top). */
const project = (az: number, el: number, dist: number, r: number) => {
  const rad = (az * Math.PI) / 180;
  const reach = r * (0.22 + 0.78 * Math.min(1, Math.max(0, dist)));
  return {
    x: Math.sin(rad) * reach,
    y: -Math.cos(rad) * reach * TILT - (el / 90) * r * 0.55,
    scale: 1 + el / 160 - dist * 0.25,
  };
};

export function SpatialStage({
  settings,
  active,
  mode,
  onPlace,
}: {
  settings: StudioSettings;
  /** Poll the engine (studio visible, music playing, 8D on). */
  active: boolean;
  mode: StageMode;
  /** Drag result: azimuth (°) and distance (0–1). */
  onPlace: (azimuth: number, distance: number) => void;
}) {
  const { t } = useTranslation();
  const [size, setSize] = useState(0);
  const r = size / 2 - 26;
  const live = useDspLive(active);

  const pos = live ?? {
    azimuth: settings.azimuth,
    elevation: settings.elevation,
    distance: settings.distance,
    peakL: 0,
    peakR: 0,
    gainReductionDb: 0,
  };

  // Source(s): stereo pair = L and R either side of the path position.
  const sources = useMemo(() => {
    const pair = settings.sourceMode === 'stereoPair' || mode === 'multi';
    return pair
      ? [
          { key: 'L', az: pos.azimuth - 35, level: pos.peakL },
          { key: 'R', az: pos.azimuth + 35, level: pos.peakR },
        ]
      : [{ key: 'S', az: pos.azimuth, level: Math.max(pos.peakL, pos.peakR) }];
  }, [settings.sourceMode, mode, pos.azimuth, pos.peakL, pos.peakR]);

  // Drag to place.
  const placeRef = useRef(onPlace);
  placeRef.current = onPlace;
  const geo = useRef({ cx: 0, cy: 0, r: 1 });
  geo.current = { cx: size / 2, cy: size / 2, r };
  // Touches are read in page space: locationX/Y are relative to whichever
  // child (speaker, ring…) is under the finger, which scrambles the position.
  const stageRef = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_, g) => {
        setDragging(true);
        // Measured now: the page may have scrolled since layout.
        stageRef.current?.measureInWindow((x, y) => {
          origin.current = { x, y };
          place(g.x0 - x, g.y0 - y);
        });
      },
      onPanResponderMove: (_, g) =>
        place(g.moveX - origin.current.x, g.moveY - origin.current.y),
      onPanResponderRelease: () => setDragging(false),
      onPanResponderTerminate: () => setDragging(false),
    }),
  ).current;
  function place(x: number, y: number) {
    const { cx, cy, r: rr } = geo.current;
    const dx = x - cx;
    const dy = (y - cy) / TILT;
    const az = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const dist = Math.min(
      1,
      Math.max(0, (Math.hypot(dx, dy) / rr - 0.22) / 0.78),
    );
    placeRef.current(Math.round(az), Math.round(dist * 100) / 100);
  }

  const onLayout = (e: LayoutChangeEvent) =>
    setSize(Math.round(e.nativeEvent.layout.width));

  const rotating = settings.pattern !== 'static' && settings.rpm > 0;
  const direction =
    settings.pattern === 'anticlockwise'
      ? '↺'
      : settings.pattern === 'clockwise'
      ? '↻'
      : '⇄';

  return (
    <View
      ref={stageRef}
      style={[styles.stage, { height: size || 320 }]}
      onLayout={onLayout}
      {...responder.panHandlers}
      accessibilityLabel={t('audioStudio.stage.label')}
      accessibilityHint={t('audioStudio.stage.hint')}
      testID="studio-stage"
    >
      {size > 0 ? (
        <>
          {/* Floor rings: near / medium / far. */}
          {[0.22, 0.61, 1].map((f, i) => (
            <View
              key={f}
              pointerEvents="none"
              style={[
                styles.ring,
                {
                  width: 2 * r * f,
                  height: 2 * r * f * TILT,
                  left: size / 2 - r * f,
                  top: size / 2 - r * f * TILT,
                  borderRadius: r * f,
                  borderColor: mode === 'distance' ? ACCENT : RING,
                  opacity: mode === 'distance' ? 0.35 + i * 0.2 : 1,
                },
              ]}
            />
          ))}
          {mode === 'distance'
            ? (['near', 'medium', 'far'] as const).map((k, i) => (
                <Text
                  key={k}
                  pointerEvents="none"
                  style={[
                    styles.ringLabel,
                    {
                      left: size / 2 + 4,
                      top: size / 2 - r * [0.22, 0.61, 1][i]! * TILT - 14,
                    },
                  ]}
                >
                  {t(`audioStudio.distance.${k}`)}
                </Text>
              ))
            : null}

          {/* Speakers. */}
          {SPEAKERS.map((name, i) => {
            const sp = SPEAKER_POSITIONS[name];
            const p = project(sp.azimuth, sp.elevation, 1, r);
            const near = sources.reduce((best, s) => {
              const d = Math.abs(
                ((((s.az - sp.azimuth) % 360) + 540) % 360) - 180,
              );
              return Math.max(
                best,
                Math.cos((d * Math.PI) / 360) ** 6 * (0.4 + s.level),
              );
            }, 0);
            const level = (settings.speakers[i] ?? 1) * settings.surround;
            return (
              <View
                key={name}
                pointerEvents="none"
                style={[
                  styles.speaker,
                  {
                    left: size / 2 + p.x - 17,
                    top: size / 2 + p.y - 17,
                    borderColor: ACCENT,
                    backgroundColor: `rgba(139,123,255,${(
                      0.12 +
                      0.6 * Math.min(1, near + level * 0.3)
                    ).toFixed(2)})`,
                  },
                ]}
              >
                <Icon name="speaker" size={16} color="#fff" />
                <Text style={styles.speakerLabel}>{name}</Text>
              </View>
            );
          })}

          {/* Listener. */}
          <View
            pointerEvents="none"
            style={[
              styles.listener,
              { left: size / 2 - 26, top: size / 2 - 26 },
            ]}
          >
            <Icon name="headphones" size={26} color="#fff" />
          </View>
          <Text
            pointerEvents="none"
            style={[styles.front, { left: size / 2 - 40, top: 6 }]}
          >
            {t('audioStudio.stage.front')}
          </Text>

          {/* Source(s). */}
          {sources.map(s => (
            <SourceDot
              key={s.key}
              label={s.key === 'S' ? '' : s.key}
              target={project(s.az, pos.elevation, pos.distance, r)}
              center={size / 2}
              level={s.level}
              active={!!live || dragging}
            />
          ))}

          {/* Status line. */}
          <View pointerEvents="none" style={styles.status}>
            <Text style={styles.statusText}>
              {rotating && mode !== 'distance'
                ? `${direction} ${t(
                    `audioStudio.patterns.${settings.pattern}`,
                  )} · ${settings.rpm} RPM`
                : `${Math.round(pos.azimuth)}° · ${t(
                    `audioStudio.distance.${
                      pos.distance < 0.15
                        ? 'extremelyNear'
                        : pos.distance < 0.4
                        ? 'near'
                        : pos.distance < 0.65
                        ? 'medium'
                        : pos.distance < 0.88
                        ? 'far'
                        : 'veryFar'
                    }`,
                  )}`}
            </Text>
            {live && Math.abs(live.gainReductionDb) > 0.5 ? (
              <Text style={styles.statusText}>
                {t('audioStudio.stage.limiting', {
                  db: (-Math.abs(live.gainReductionDb)).toFixed(1),
                })}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** A glowing source with sound waves; glides to each new engine position. */
function SourceDot({
  label,
  target,
  center,
  level,
  active,
}: {
  label: string;
  target: { x: number; y: number; scale: number };
  center: number;
  level: number;
  active: boolean;
}) {
  const xy = useRef(new Animated.ValueXY({ x: target.x, y: target.y })).current;
  const wave = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(xy, {
      toValue: { x: target.x, y: target.y },
      duration: 150,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [target.x, target.y, xy]);

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.timing(wave, {
        toValue: 1,
        duration: 1400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, wave]);

  const size = 22 * Math.max(0.6, target.scale);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.sourceWrap,
        {
          left: center - 40,
          top: center - 40,
          transform: [{ translateX: xy.x }, { translateY: xy.y }],
        },
      ]}
    >
      {[0].map(offset => (
        <Animated.View
          key={offset}
          style={[
            styles.wave,
            {
              opacity: active
                ? wave.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.55 * (0.4 + level), 0],
                  })
                : 0,
              transform: [
                {
                  scale: wave.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3 + offset, 1.6 + offset],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
      <View
        style={[
          styles.source,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        {label ? <Text style={styles.sourceLabel}>{label}</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: '100%',
    backgroundColor: STUDIO_BG,
    borderRadius: 20,
    overflow: 'hidden',
  },
  ring: { position: 'absolute', borderWidth: 1 },
  ringLabel: {
    position: 'absolute',
    color: 'rgba(200,205,255,0.7)',
    fontSize: 10,
  },
  speaker: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerLabel: {
    color: '#cfd3ff',
    fontSize: 8,
    fontWeight: '700',
    position: 'absolute',
    bottom: -12,
  },
  listener: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2a2f45',
    borderWidth: 2,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  front: {
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    color: 'rgba(200,205,255,0.6)',
    fontSize: 11,
  },
  sourceWrap: {
    position: 'absolute',
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: SOURCE,
  },
  source: {
    backgroundColor: SOURCE,
    alignItems: 'center',
    justifyContent: 'center',
    // A ring instead of a shadow/elevation glow: shadows re-rasterise every frame.
    borderWidth: 3,
    borderColor: 'rgba(255,106,213,0.35)',
  },
  sourceLabel: { color: '#fff', fontSize: 10, fontWeight: '800' },
  status: { position: 'absolute', left: 12, bottom: 10, right: 12 },
  statusText: { color: 'rgba(220,225,255,0.85)', fontSize: 12 },
});
