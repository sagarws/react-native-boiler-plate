import { toParamArray } from '../dsp/params';
import {
  BUILT_IN_EQ,
  BUILT_IN_PRESETS,
  DEFAULT_SETTINGS,
  ROOMS,
} from '../dsp/presets';
import { studioStore } from '../store/stores';
import type {
  EqProfile,
  RoomPreset,
  SpatialPreset,
  StudioSettings,
} from '../types';
import { audioNative } from './native.service';

/*
 * DSP settings → native engine. Every change is saved and sent at once (the
 * engine smooths it, so dragging a slider never clicks); sends are coalesced
 * to one per animation frame while dragging.
 */

let pending: ReturnType<typeof setTimeout> | null = null;

const push = () => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    audioNative.setDspParams(toParamArray(studioStore.read().settings));
  }, 16);
};

const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;

export const studioService = {
  /** Sends the saved settings (app start). */
  sync(): void {
    audioNative.setDspParams(toParamArray(studioStore.read().settings));
  },

  /** A manual change: the preset becomes "modified" (null). */
  update(patch: Partial<StudioSettings>, keepPreset = false): void {
    studioStore.update(d => ({
      ...d,
      settings: { ...d.settings, ...patch },
      presetId: keepPreset ? d.presetId : null,
    }));
    push();
  },

  setRoom(room: RoomPreset): void {
    this.update(room === 'custom' ? { room } : { room, ...ROOMS[room] });
  },

  // ── spatial presets ──

  /** Built-ins (with the user's saved edits) followed by custom presets. */
  presets(): SpatialPreset[] {
    const saved = studioStore.read().presets;
    const byId = new Map(saved.map(p => [p.id, p]));
    const builtIns = BUILT_IN_PRESETS.map(b => {
      const edit = byId.get(b.id);
      return edit ? { ...edit, builtIn: true } : b;
    });
    const custom = saved.filter(
      p => !BUILT_IN_PRESETS.some(b => b.id === p.id),
    );
    return [...builtIns, ...custom];
  },

  applyPreset(id: string): void {
    const preset = this.presets().find(p => p.id === id);
    if (!preset) return;
    studioStore.update(d => ({
      ...d,
      // Keep the user's EQ and quality; the preset sets the spatial sound.
      settings: {
        ...DEFAULT_SETTINGS,
        ...preset.settings,
        quality: d.settings.quality,
        eqEnabled: d.settings.eqEnabled,
        eq: preset.settings.eq ?? d.settings.eq,
        preamp: preset.settings.preamp ?? d.settings.preamp,
      },
      presetId: id,
    }));
    push();
  },

  /** Saves the current sound as a new custom preset. */
  saveAsPreset(name: string): string {
    const id = newId('preset');
    studioStore.update(d => ({
      ...d,
      presets: [
        ...d.presets,
        {
          id,
          name: name.trim().slice(0, 40) || 'My preset',
          builtIn: false,
          settings: { ...d.settings },
        },
      ],
      presetId: id,
    }));
    return id;
  },

  /** Overwrites a preset (custom, or a built-in's saved edit) with the current sound. */
  updatePreset(id: string): void {
    const preset = this.presets().find(p => p.id === id);
    if (!preset) return;
    studioStore.update(d => ({
      ...d,
      presets: [
        ...d.presets.filter(p => p.id !== id),
        { ...preset, settings: { ...d.settings } },
      ],
      presetId: id,
    }));
  },

  renamePreset(id: string, name: string): void {
    const preset = this.presets().find(p => p.id === id);
    if (!preset) return;
    studioStore.update(d => ({
      ...d,
      presets: [
        ...d.presets.filter(p => p.id !== id),
        { ...preset, name: name.trim().slice(0, 40) || preset.name },
      ],
    }));
  },

  /** Custom: removed. Built-in: back to its original values. */
  deletePreset(id: string): void {
    studioStore.update(d => ({
      ...d,
      presets: d.presets.filter(p => p.id !== id),
      presetId: d.presetId === id ? null : d.presetId,
    }));
  },

  /** Every built-in back to factory values; custom presets kept. */
  restoreDefaults(): void {
    studioStore.update(d => ({
      ...d,
      presets: d.presets.filter(
        p => !BUILT_IN_PRESETS.some(b => b.id === p.id),
      ),
    }));
    this.applyPreset('ultra8d');
  },

  // ── EQ profiles ──

  eqProfiles(): EqProfile[] {
    return [...BUILT_IN_EQ, ...studioStore.read().eqProfiles];
  },

  applyEq(id: string): void {
    const p = this.eqProfiles().find(e => e.id === id);
    if (!p) return;
    studioStore.update(d => ({
      ...d,
      settings: {
        ...d.settings,
        eqEnabled: true,
        preamp: p.preamp,
        eq: [...p.eq],
        bass: p.bass || d.settings.bass,
        treble: p.treble,
        vocal: p.vocal || d.settings.vocal,
      },
      eqProfileId: id,
    }));
    push();
  },

  setEqBand(band: number, db: number): void {
    studioStore.update(d => {
      const eq = [...d.settings.eq];
      eq[band] = db;
      return { ...d, settings: { ...d.settings, eq }, eqProfileId: null };
    });
    push();
  },

  saveEqProfile(name: string): void {
    const s = studioStore.read().settings;
    const id = newId('eq');
    studioStore.update(d => ({
      ...d,
      eqProfiles: [
        ...d.eqProfiles,
        {
          id,
          name: name.trim().slice(0, 40) || 'My EQ',
          builtIn: false,
          preamp: s.preamp,
          eq: [...s.eq],
          bass: s.bass,
          treble: s.treble,
          vocal: s.vocal,
        },
      ],
      eqProfileId: id,
    }));
  },

  deleteEqProfile(id: string): void {
    studioStore.update(d => ({
      ...d,
      eqProfiles: d.eqProfiles.filter(p => p.id !== id),
      eqProfileId: d.eqProfileId === id ? null : d.eqProfileId,
    }));
  },
};
