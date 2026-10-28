import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import {
  utilityNative,
  type CompassReading,
  type CompassSupport,
} from '../services/native.service';
import { utilityStore } from '../store/utility.store';
import type { UtilityData, WaterMode } from '../types';

export function useUtilityData(): UtilityData {
  return useSyncExternalStore(utilityStore.subscribe, utilityStore.read);
}

/** 'unknown' (at launch) counts as foreground; only background/inactive don't. */
const isForeground = (s: string | null | undefined) =>
  s !== 'background' && s !== 'inactive';

/** True while this screen is on top and the app is in the foreground. */
export function useScreenActive(): boolean {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(() =>
    isForeground(AppState.currentState),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', s =>
      setForeground(isForeground(s)),
    );
    return () => sub.remove();
  }, []);
  return focused && foreground;
}

/**
 * Compass readings while the screen is active; the sensors are released as
 * soon as it isn't (another screen, app in background, unmount).
 */
export function useCompass(): {
  support: CompassSupport | 'checking';
  reading: CompassReading | null;
} {
  const active = useScreenActive();
  const [support, setSupport] = useState<CompassSupport | 'checking'>(
    'checking',
  );
  const [reading, setReading] = useState<CompassReading | null>(null);

  useEffect(() => {
    let cancelled = false;
    utilityNative
      .compassSupport()
      .then(s => !cancelled && setSupport(s))
      .catch(() => !cancelled && setSupport('none'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active || support === 'checking' || support === 'none') return;
    return utilityNative.watchCompass(setReading);
  }, [active, support]);

  return { support, reading };
}

export type WaterState =
  | { kind: 'idle' }
  | { kind: 'playing'; endsAt: number }
  | { kind: 'ended'; reason: 'finished' | 'interrupted' | 'stopped' | 'error' }
  | { kind: 'denied' }
  | { kind: 'unavailable' };

/**
 * Speaker Water Eject playback. Starts only from an explicit call; stops on
 * Stop, when the time is up, when audio is interrupted, and whenever the
 * screen stops being active — never keeps playing in the background.
 */
export function useWaterEject() {
  const active = useScreenActive();
  const [state, setState] = useState<WaterState>({ kind: 'idle' });
  const [now, setNow] = useState(Date.now());
  const [hasVibrator, setHasVibrator] = useState(false);
  const playing = useRef(false);

  useEffect(() => {
    utilityNative
      .hasVibrator()
      .then(setHasVibrator, () => setHasVibrator(false));
    const off = utilityNative.onToneEnded(reason => {
      playing.current = false;
      setState({
        kind: 'ended',
        reason: (['finished', 'interrupted', 'stopped'].includes(reason)
          ? reason
          : 'error') as 'finished' | 'interrupted' | 'stopped' | 'error',
      });
    });
    return () => {
      off();
      if (playing.current) utilityNative.stopTone();
    };
  }, []);

  useEffect(() => {
    if (!active && playing.current) {
      playing.current = false;
      utilityNative.stopTone();
      setState({ kind: 'ended', reason: 'stopped' });
    }
  }, [active]);

  useEffect(() => {
    if (state.kind !== 'playing') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.kind]);

  const start = async (mode: WaterMode, seconds: number, vibrate: boolean) => {
    if (!utilityNative.available()) {
      setState({ kind: 'unavailable' });
      return;
    }
    try {
      const result = await utilityNative.startTone(
        mode,
        seconds,
        vibrate && hasVibrator,
      );
      if (result === 'focus_denied') {
        setState({ kind: 'denied' });
        return;
      }
      playing.current = true;
      setNow(Date.now());
      setState({ kind: 'playing', endsAt: Date.now() + seconds * 1000 });
    } catch {
      setState({ kind: 'ended', reason: 'error' });
    }
  };

  const stop = () => {
    if (!playing.current) return;
    playing.current = false;
    utilityNative.stopTone();
    setState({ kind: 'ended', reason: 'stopped' });
  };

  const remaining =
    state.kind === 'playing'
      ? Math.max(0, Math.ceil((state.endsAt - now) / 1000))
      : 0;
  return { state, remaining, hasVibrator, start, stop };
}
