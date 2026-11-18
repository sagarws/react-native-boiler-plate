import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app } from 'electron'
import type { BinaryFormat } from '@shared/vms/binaryFormat'
import { detectBinaryFormat, expectedFormatFor, formatOsName, isForeignBinary } from '@shared/vms/binaryFormat'
import { platform } from '../platform'
import { logger } from '../services/logger'
import { unpacked } from '../services/mediaTools.service'

/**
 * Where the ffmpeg executable is, and whether it can run here — Argos Watch's
 * ffmpegPath.ts, resolved the CMS's way.
 *
 * Order:
 *   1. `resources/ffmpeg/ffmpeg[.exe]` when a packaged build carries a staged
 *      copy (Argos staged one per target; the CMS does not yet, so this is
 *      normally absent and skipped).
 *   2. `FFMPEG_PATH`, which `initialiseMediaTools()` sets at startup from
 *      ffmpeg-static with the asar → asar.unpacked rewrite — the same binary the
 *      claim-video shrinking already spawns.
 *   3. ffmpeg-static directly (unpacked), for a run where (2) has not happened.
 *
 * A file built for another OS (a Windows installer cross-built on a Mac) is
 * reported as unusable, with a sentence an operator can screenshot.
 */

export interface FfmpegBinaryInfo {
  path: string
  source: 'staged' | 'env' | 'ffmpeg-static' | 'path-fallback'
  exists: boolean
  format: BinaryFormat | null
  usable: boolean
  problem: string | null
}

const load = createRequire(import.meta.url)

const readFormat = (path: string): BinaryFormat | null => {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const head = Buffer.alloc(4)
    const bytes = readSync(fd, head, 0, 4, 0)
    return detectBinaryFormat(head.subarray(0, bytes))
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // Nothing useful to do if the descriptor will not close.
      }
    }
  }
}

const executableName = (): string => (platform.name === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

const inspect = (path: string, source: FfmpegBinaryInfo['source']): FfmpegBinaryInfo => {
  if (!existsSync(path)) {
    return {
      path,
      source,
      exists: false,
      format: null,
      usable: false,
      problem: `The ffmpeg program is missing from this installation (expected at ${path}).`
    }
  }
  const format = readFormat(path)
  if (format && isForeignBinary(format, platform.name)) {
    return {
      path,
      source,
      exists: true,
      format,
      usable: false,
      problem:
        `The bundled ffmpeg program was built for ${formatOsName(format)}, but this is ` +
        `${formatOsName(expectedFormatFor(platform.name) ?? 'unknown')}. ` +
        'The installer was packaged on the wrong operating system.'
    }
  }
  return { path, source, exists: true, format, usable: true, problem: null }
}

const fromStatic = (): string | null => {
  try {
    const reported = load('ffmpeg-static') as unknown
    return typeof reported === 'string' && reported.length > 0 ? unpacked(reported) : null
  } catch {
    return null
  }
}

let cached: FfmpegBinaryInfo | null = null

export const resolveFfmpeg = (): FfmpegBinaryInfo => {
  if (cached) return cached

  const candidates: Array<{ path: string | null; source: FfmpegBinaryInfo['source'] }> = [
    { path: app.isPackaged ? join(process.resourcesPath, 'ffmpeg', executableName()) : null, source: 'staged' },
    { path: process.env['FFMPEG_PATH'] ?? null, source: 'env' },
    { path: fromStatic(), source: 'ffmpeg-static' }
  ]

  let last: FfmpegBinaryInfo | null = null
  for (const candidate of candidates) {
    if (!candidate.path) continue
    const info = inspect(candidate.path, candidate.source)
    if (info.usable) {
      cached = info
      logger.info('[vms] ffmpeg resolved', { path: info.path, source: info.source, format: info.format })
      return cached
    }
    // A staged copy that is simply absent is the normal case, not worth keeping as the reason.
    if (!(candidate.source === 'staged' && !info.exists)) last = info
  }

  cached = last ?? {
    path: 'ffmpeg',
    source: 'path-fallback',
    exists: false,
    format: null,
    usable: false,
    problem: `No ffmpeg build is bundled for ${platform.name}-${process.arch}. The installer for this architecture was built without one.`
  }
  logger.error('[vms] ffmpeg is not usable', { path: cached.path, source: cached.source, problem: cached.problem })
  return cached
}

/** Test seam: forces the next resolveFfmpeg() to look again. */
export const resetFfmpegResolution = (): void => {
  cached = null
}
