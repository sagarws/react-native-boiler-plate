/**
 * The version claimed when this host's Chrome cannot be asked.
 *
 * Kept current deliberately: a version that has aged out of the release channel
 * is itself a signal, which is half of what was wrong with driving the pinned
 * Chrome-for-Testing 131. Bump it when it starts to look old.
 */
export const FALLBACK_CHROME_MAJOR: 152;
/**
 * The installed Chrome's major version, read off disk. Null when it cannot be.
 *
 * Windows lays its Chrome out as
 * `…\Application\<full version>\chrome.dll`, so the directory listing IS the
 * version — no process to spawn, nothing to parse out of `--version`, and it
 * costs one readdir. macOS and Linux keep no such directory, so they fall back
 * rather than paying for a subprocess on every call.
 */
export function installedChromeMajor({ binary, readdir, }?: {
    binary?: string;
    readdir?: typeof fs.readdirSync;
}): number;
/**
 * The user-agent and client hints to send with a jar this host's browser minted.
 *
 * @param {{ platform?: string, major?: number|null }} [options]
 *        `major` null means "ask this host"; a number is used as given, which
 *        is what the tests do.
 * @returns {{ userAgent: string, headers: Record<string, string>, major: number }}
 */
export function myntraBrowserIdentity({ platform, major }?: {
    platform?: string;
    major?: number | null;
}): {
    userAgent: string;
    headers: Record<string, string>;
    major: number;
};
import fs = require("fs");
