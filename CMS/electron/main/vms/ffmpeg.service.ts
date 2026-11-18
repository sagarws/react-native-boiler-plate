import { spawn } from 'node:child_process'
import { cpus } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import {
  COMPRESSED_AUDIO_HANDLING,
  COMPRESSED_CONTAINER_EXTENSION,
  COMPRESSED_VIDEO_CODEC,
  COMPRESSION_CRF,
  FFMPEG_CPU_THRESHOLD,
  FFMPEG_PRESET_HIGH_CPU,
  FFMPEG_PRESET_LOW_CPU,
  FFMPEG_THREAD_PERCENT,
  type CompressionLevel
} from '@shared/vms/compression'
import { logger } from '../services/logger'
import { resolveFfmpeg } from './ffmpegPath'

/**
 * The two ffmpeg jobs the upload driver needs, spawned directly (Argos used
 * fluent-ffmpeg; the CMS adds no dependency for argv building).
 *
 *   remuxWebm         `-c copy` into a fresh WebM. MediaRecorder writes a WebM
 *                     with no duration in its header; Argos' renderer patched
 *                     that with fix-webm-duration before upload. A copy-remux
 *                     writes the duration properly, with no re-encode.
 *   compressForUpload Argos' libx264 re-encode, same CRF / preset / thread
 *                     budget (shared/vms/compression.ts). `similar` is the
 *                     no-op fast path.
 */

const STDERR_TAIL = 4_000

/** One ffmpeg run. Resolves on exit 0; rejects with the tail of stderr otherwise. */
export const runFfmpeg = (args: readonly string[]): Promise<void> => {
  const binary = resolveFfmpeg()
  if (!binary.usable) return Promise.reject(new Error(binary.problem ?? 'ffmpeg is not available on this machine'))

  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary.path, ['-hide_banner', '-loglevel', 'error', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL)
    })
    child.once('error', (error) => reject(error))
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`ffmpeg exited with ${code ?? signal ?? 'unknown'}: ${stderr.trim() || 'no output'}`))
    })
  })
}

const stripExtension = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export const isWebm = (path: string): boolean => extname(path).toLowerCase() === '.webm'

/** `<name>.remux.webm` beside the input, stream-copied so the container carries its duration. */
export const remuxWebm = async (inputPath: string): Promise<string> => {
  const outputPath = join(dirname(inputPath), `${stripExtension(basename(inputPath))}.remux.webm`)
  await runFfmpeg(['-y', '-i', inputPath, '-c', 'copy', outputPath])
  logger.info('[vms] recording remuxed', { input: inputPath, output: outputPath })
  return outputPath
}

const pickPreset = (): string => {
  const cores = cpus().length || 1
  return cores <= FFMPEG_CPU_THRESHOLD ? FFMPEG_PRESET_LOW_CPU : FFMPEG_PRESET_HIGH_CPU
}

const pickThreadCount = (): number => {
  const cores = cpus().length || 1
  return Math.max(1, Math.ceil((cores * FFMPEG_THREAD_PERCENT) / 100))
}

/** Argos' argv, as fluent-ffmpeg built it: `-y -i in -vcodec … -acodec … -preset … -crf … -threads … out`. */
export const compressionArgs = (
  inputPath: string,
  outputPath: string,
  level: Exclude<CompressionLevel, 'similar'>,
  preset: string,
  threads: number
): string[] => [
  '-y',
  '-i',
  inputPath,
  '-vcodec',
  COMPRESSED_VIDEO_CODEC,
  '-acodec',
  COMPRESSED_AUDIO_HANDLING,
  '-preset',
  preset,
  '-crf',
  String(COMPRESSION_CRF[level]),
  '-threads',
  String(threads),
  outputPath
]

/**
 * Re-encode for upload by the company compression level. Returns the path to
 * upload: the input itself for `similar`, else `<name>.compressed.mp4` beside it.
 */
export const compressForUpload = async (inputPath: string, level: CompressionLevel): Promise<string> => {
  if (level === 'similar') return inputPath
  const outputPath = join(
    dirname(inputPath),
    `${stripExtension(basename(inputPath))}.compressed${COMPRESSED_CONTAINER_EXTENSION}`
  )
  const preset = pickPreset()
  const threads = pickThreadCount()
  await runFfmpeg(compressionArgs(inputPath, outputPath, level, preset, threads))
  logger.info('[vms] video compressed for upload', {
    input: inputPath,
    output: outputPath,
    level,
    crf: COMPRESSION_CRF[level],
    preset,
    threads
  })
  return outputPath
}
