import { version } from '../../../package.json';

/**
 * The JS bundle's version, reported to the backend at login and shown in
 * settings. Read from package.json rather than a native module so an
 * over-the-air bundle swap reports the version that is actually running.
 */
export const appVersion: string = version;
