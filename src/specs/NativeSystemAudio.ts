import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for 8D Audio Studio's "Other apps" mode
 * (android/app/src/main/java/com/rnboilerplate/systemaudio/SystemAudioModule.kt).
 *
 * Only the audioStudio feature's service layer may import this file.
 *
 * Two best-effort routes, because Android gives no app free access to other
 * apps' sound:
 *
 * 1. Session effects — players that announce their audio session
 *    (AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION; many music apps
 *    do, YouTube usually does not) get Android's own effects attached:
 *    Equalizer, BassBoost, Virtualizer, PresetReverb, LoudnessEnhancer,
 *    driven by the studio's parameter array. No 8D movement this way.
 *
 * 2. Playback capture (Android 10+) — with the user's screen-capture consent,
 *    AudioPlaybackCapture records audio that apps allow to be captured
 *    (USAGE_MEDIA / GAME / UNKNOWN; never calls or the microphone), runs it
 *    through the 8D engine (same parameters as the player) and plays the
 *    result. Android does not mute the original app, so the user hears both
 *    unless the original is silenced (see setCaptureOutput). Apps that forbid
 *    capture or play DRM content deliver silence — reported, never bypassed.
 *
 * Status JSON (getStatus, and the `SystemAudioEvent` {type:'status', body}):
 * {
 *   sessions: [{sessionId, packageName, appLabel, attached}],
 *   effectsEnabled, effectsSupported: {equalizer, bassBoost, virtualizer, reverb, loudness},
 *   capture: {supported (API ≥ 29), running, outputMode: 'media'|'accessibility',
 *             inputDb, outputDb, silentMs (how long the captured input has been silent),
 *             latencyMs, error: string|null}
 * }
 */
export interface Spec extends TurboModule {
  getStatus(): Promise<string>;

  /** Attach (true) / detach (false) system effects to every announced session, now and later. */
  setEffectsEnabled(enabled: boolean): void;
  /** The studio's engine parameter array (same as AudioStudio.setDspParams), mapped to system effects. */
  setEffectParams(params: number[]): void;

  /**
   * Asks for screen-capture consent, then starts the capture service.
   * Rejects 'unsupported' (< Android 10), 'denied' (consent refused),
   * 'permission' (RECORD_AUDIO missing — JS asks for it first).
   */
  startCapture(): Promise<void>;
  stopCapture(): void;
  /**
   * 'media': processed sound plays as music (simple, but the original is
   * also heard). 'accessibility': plays on the accessibility stream, so the
   * user can turn the media volume down to silence the original while
   * hearing the 8D version (works only where the device keeps that stream
   * separate and still captures at low media volume — reported in status).
   */
  setCaptureOutput(mode: string): void;

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('SystemAudio');
