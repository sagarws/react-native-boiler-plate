import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { logger } from './logger'

/**
 * `createRequire` rather than a bare `require()`, for the reason given in
 * coreLoader: this file is ESM at author time and bundled to CJS, and the lint
 * rule banning `require()` is right about imports. These are deliberate runtime
 * loads of packages that may not be installed.
 */
const load = createRequire(import.meta.url)

/**
 * Where ffmpeg and ffprobe are on THIS machine, told to the core once at startup.
 *
 * The core resolves them itself — env first, then the bundled packages, then
 * PATH — and would find these packages unaided. What it cannot know is asar.
 *
 * ASAR IS THE WHOLE REASON THIS FILE EXISTS. A packaged app keeps its
 * node_modules inside app.asar, which is an archive: the path the package
 * reports is real to Node's patched `fs`, but it is not a file the operating
 * system can execute. electron-builder copies anything listed under `asarUnpack`
 * into a sibling app.asar.unpacked directory, and the runnable binary is the
 * same path with that one segment swapped. Knowing that is the consumer's job —
 * the core has no idea it is being run inside an Electron bundle.
 *
 * Told through the environment rather than an argument because the core reads
 * these before anything else, and because the server consumer sets the same two
 * variables when it wants a particular build. One contract, two ways in.
 *
 * Failure here is not fatal. Without a binary an oversized video simply is not
 * shrunk, and the upload fails with the marketplace's own size message — which
 * is exactly how the app behaved before any of this existed.
 */

/** The path a bundled package reports, made executable if it lives inside the asar. */
export const unpacked = (binary: string): string =>
  binary.includes('app.asar') ? binary.replace('app.asar', 'app.asar.unpacked') : binary

const locate = (load: () => string, name: string): string | null => {
  try {
    const reported = load()

    if (!reported) return null

    const real = unpacked(reported)

    if (!existsSync(real)) {
      // Almost always a cross-built installer: these packages fetch only the
      // binary for the platform they were INSTALLED on, so a Windows build made
      // on a Mac ships a macOS ffmpeg or none at all.
      logger.warn(`[media] ${name} is declared at ${real} but is not there — videos will not be shrunk`)

      return null
    }

    return real
  } catch {
    // Not installed. The core still has PATH to fall back on.
    return null
  }
}

/**
 * Points the core at this machine's binaries. Safe to call more than once.
 *
 * An explicitly-set FFMPEG_PATH always wins: someone who has pointed this at a
 * particular build has a reason, and the bundled copy must not quietly override
 * it.
 */
export const initialiseMediaTools = (): void => {
  if (!process.env['FFMPEG_PATH']) {
    // Literal specifiers, never computed — the main process is bundled.
    const ffmpeg = locate(() => load('ffmpeg-static') as string, 'ffmpeg')

    if (ffmpeg) process.env['FFMPEG_PATH'] = ffmpeg
  }

  if (!process.env['FFPROBE_PATH']) {
    const ffprobe = locate(
      () => (load('@ffprobe-installer/ffprobe') as { path: string }).path,
      'ffprobe'
    )

    if (ffprobe) process.env['FFPROBE_PATH'] = ffprobe
  }

  const ready = Boolean(process.env['FFMPEG_PATH'] && process.env['FFPROBE_PATH'])

  logger.info(
    ready
      ? '[media] ffmpeg is available — oversized claim videos will be re-encoded to fit'
      : '[media] no ffmpeg on this machine — an oversized claim video will be refused by the marketplace'
  )
}
