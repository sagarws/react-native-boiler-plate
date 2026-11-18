/**
 * Can this machine drive the operator's own Google Chrome?
 *
 * Myntra's sign-in has to run in the installed Chrome, with a chromedriver of
 * the same major version. When either is missing the core falls back to the
 * pinned Chrome for Testing, which Myntra's edge refuses with a red "Network
 * Error". This record is what the rail reads to say so before a capture fails.
 */
export interface BrowserCheck {
  chrome: {
    found: boolean
    /** The chrome.exe / app binary that was found, or null. */
    path: string | null
    /** Full version, e.g. "152.0.7300.12", or null when it could not be read. */
    version: string | null
  }
  driver: {
    /** A chromedriver matching the installed Chrome is on this machine. */
    ready: boolean
    /**
     * The exact archive to download for this Chrome, when the app could look
     * its build up; null sends the operator to the general page instead.
     */
    downloadUrl: string | null
  }
  /** ISO timestamp of the check. */
  checkedAt: string
}

/** Where an operator installs each piece by hand. */
export const BROWSER_DOWNLOAD_LINKS = {
  chrome: 'https://www.google.com/chrome/',
  chromedriver: 'https://googlechromelabs.github.io/chrome-for-testing/'
} as const
