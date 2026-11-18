import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Centralised logger.
 *
 * Writes to Electron's per-platform log directory (app.getPath('logs')) so the
 * location is correct on Windows and macOS without any hard-coded path. A single
 * append stream is reused to avoid one file handle per log line, and the level
 * is raised in packaged builds to keep production disk/CPU cost low.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let stream: WriteStream | null = null
let minimumLevel: LogLevel = 'info'

const timestamp = (): string => new Date().toISOString()

const serialise = (value: unknown): string => {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const write = (level: LogLevel, message: string, meta?: unknown): void => {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel]) return

  const line = `[${timestamp()}] [${level.toUpperCase()}] ${message}${meta === undefined ? '' : ` ${serialise(meta)}`}`

  if (!app.isPackaged) {
    // Console output is development-only; stdout is used for the non-problem
    // levels so this stays within the project's no-console policy.
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else process.stdout.write(`${line}\n`)
  }
  stream?.write(`${line}\n`)
}

export const logger = {
  /** Called once, after app.whenReady(), because app.getPath('logs') needs a ready app. */
  init(): void {
    if (stream) return
    minimumLevel = app.isPackaged ? 'info' : 'debug'
    try {
      const directory = app.getPath('logs')
      mkdirSync(directory, { recursive: true })
      stream = createWriteStream(join(directory, 'main.log'), { flags: 'a' })
      stream.on('error', (error) => {
        // Never let a logging failure take the app down.
        stream = null
        console.error('[logger] file logging disabled:', error.message)
      })
    } catch (error) {
      console.error('[logger] could not open log file:', error instanceof Error ? error.message : error)
    }
  },
  debug: (message: string, meta?: unknown): void => write('debug', message, meta),
  info: (message: string, meta?: unknown): void => write('info', message, meta),
  warn: (message: string, meta?: unknown): void => write('warn', message, meta),
  error: (message: string, meta?: unknown): void => write('error', message, meta),
  close(): void {
    stream?.end()
    stream = null
  }
}
