import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import JavaScriptObfuscator from 'javascript-obfuscator'

const loadEnvFile = () => {
  const envFile = resolve(__dirname, '.env')
  if (!existsSync(envFile)) return
  for (const rawLine of readFileSync(envFile, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    if (key === '' || process.env[key] !== undefined) continue

    process.env[key] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
}

/**
 * Post-build JavaScript obfuscation for the electron-vite bundles.
 *
 * Runs in `writeBundle`, i.e. after Rollup has written each target's output to
 * disk, and rewrites every emitted `.js` file in place with an obfuscated copy.
 * It is a deliberate second pass over already-minified output: esbuild's minify
 * shortens names, this mangles control flow and (for main) injects dead code.
 *
 * Only runs in production builds. Obfuscating dev output would slow rebuilds
 * and make main/preload impossible to debug — and `electron-vite dev` does
 * build those two (in watch mode) even though it serves the renderer, so the
 * guard is a production-mode check, not just `apply: 'build'`. See the
 * obfuscatorPlugin() body for why.
 *
 * The three targets each add this plugin and each iterate all three output
 * directories, so a marker line is appended after obfuscating a file and files
 * that already carry it are skipped. That makes the pass idempotent: whichever
 * target runs first obfuscates a freshly written file, and the later targets
 * leave it alone instead of obfuscating it two or three times over.
 */

// The output directories, resolved once against this file's location (project
// root). Order is cosmetic; each is guarded independently below.
const OUTPUT_DIRS = ['out/renderer', 'out/preload', 'out/main'].map((dir) => resolve(__dirname, dir))

// Trailing sentinel written after a file is obfuscated. Its only job is to let a
// later target's pass recognise "already done" and skip the file.
const MARKER = '/*__trackvid_obfuscated__*/'

/** Every `.js` file under `dir`, recursively (renderer chunks live in assets/). */
const collectJsFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(full)))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full)
    }
  }

  return files
}

const obfuscateDir = async (dir, options) => {
  // fs.access is the skip-gracefully guard: a target may run before another
  // target's directory exists, and that is expected, not an error.
  try {
    await access(dir)
  } catch {
    return
  }

  try {
    const files = await collectJsFiles(dir)
    let obfuscated = 0

    for (const file of files) {
      const code = await readFile(file, 'utf8')
      if (code.includes(MARKER)) continue // already obfuscated by an earlier target's pass

      const result = JavaScriptObfuscator.obfuscate(code, options)
      await writeFile(file, `${result.getObfuscatedCode()}\n${MARKER}\n`, 'utf8')
      obfuscated += 1
    }

    if (obfuscated > 0) {
      console.log(`[obfuscator] ${dir}: obfuscated ${obfuscated} file(s)`)
    }
  } catch (error) {
    // A failed directory must not silently ship un-obfuscated code, so surface
    // it loudly, but keep it scoped to the directory rather than aborting the
    // other two.
    console.error(`[obfuscator] failed to obfuscate ${dir}:`, error)
  }
}

/**
 * @param {import('javascript-obfuscator').ObfuscatorOptions} [options]
 *   Passed straight to javascript-obfuscator for every file in this pass.
 * @returns {import('vite').Plugin}
 */
export function obfuscatorPlugin(options = {}) {
  // Gate obfuscation to production builds. `apply: 'build'` alone is not enough:
  // `electron-vite dev` serves the renderer (command 'serve', excluded) but
  // still builds main and preload through Vite's build API in watch mode
  // (command 'build'), so writeBundle would otherwise fire — and obfuscate them
  // — on every dev rebuild. `electron-vite build` runs in production mode; dev
  // runs in development mode, so isProduction is the reliable discriminator.
  let isProduction = false

  return {
    name: 'trackvid-obfuscator',
    apply: 'build',
    configResolved(config) {
      isProduction = config.isProduction || config.mode === 'production'
    },
    async writeBundle() {
      if (!isProduction) return
      loadEnvFile()
      const obfuscateEnv = (process.env.TRACKVID_OBFUSCATE ?? process.env.OBFUSCATE ?? 'true').trim().toLowerCase()
      if (obfuscateEnv === 'false' || obfuscateEnv === '0' || obfuscateEnv === 'off') {
        console.log('[obfuscator] skipped (disabled via env)')
        return
      }
      for (const dir of OUTPUT_DIRS) {
        await obfuscateDir(dir, options)
      }
    }
  }
}

export default obfuscatorPlugin
