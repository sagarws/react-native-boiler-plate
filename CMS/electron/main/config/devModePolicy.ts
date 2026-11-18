/**
 * Whether developer mode survives a restart.
 *
 * `DEV_MODE_PERSIST=true` in .env — inlined at build time by
 * electron.vite.config.ts, as IMPERSON_LOGIN is. Unset, or anything but the
 * exact string "true", and every launch opens with developer mode OFF, whatever
 * the last session left in preferences.json: the extra screens are unlocked for
 * one sitting, and an operator's machine does not stay in them by accident.
 *
 * A function rather than the bare constant, so tests can answer both ways.
 */
export const devModePersistsAcrossRestarts = (): boolean => __DEV_MODE_PERSIST__
