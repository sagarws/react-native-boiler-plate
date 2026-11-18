#!/usr/bin/env node
/*
 * Obfuscates the built bundles, as the last step before packaging.
 *
 * WHY A STEP AND NOT A VITE PLUGIN. Run inside the build, this would rewrite
 * the output before `verify:secrets` ever sees it — and that check works by
 * grepping the artifact for the literal values in .env. Obfuscation lifts most
 * strings into an encoded array, so the guard would stop finding what it is
 * there to find. Worse than useless: with `stringArrayThreshold` below 1 the
 * result is PROBABILISTIC — a quarter of strings stay literal, so the same
 * secret would be caught on one build and missed on the next. A gate that
 * passes by luck is worse than no gate. So the order is fixed:
 *
 *     build -> verify:secrets (on plain output) -> obfuscate
 *
 * WHAT IT COVERS. `out/main` and `out/preload`. NOT `out/renderer`, and the
 * reason is measured rather than assumed — see below.
 *
 * ── WHY THE RENDERER IS NOT OBFUSCATED ──────────────────────────────────────
 *
 * It was, and it broke the packaged app: MUI rendered unstyled on the login
 * screen and the window went blank after signing in, on a build that compiled,
 * linted and tested clean. Static CSS still loaded; only the styles emotion
 * injects at RUNTIME were missing, which is the signature of renderer modules
 * failing during evaluation rather than a CSS packaging fault.
 *
 * The honest position is that the precise transform at fault was never pinned
 * down. A CSP theory — that `selfDefending` emits a `Function` constructor
 * call, which `script-src 'self'` would block — was tested against the actual
 * shipped chunks and DISPROVED: zero `.constructor(` and zero `new Function(`
 * in any of them.
 *
 * It does not matter, because the cost/benefit was measured and it is not
 * close:
 *
 *     bundle          size     files containing marketplace logic
 *     out/main        313 KB   0
 *     out/preload     ~30 KB   0
 *     out/renderer     19 MB   0     <- and it is what breaks
 *     the core        4.4 MB   17    <- and it ships READABLE (see below)
 *
 * The renderer is React, MUI, emotion and html2canvas. It holds no marketplace
 * endpoint, no login flow and no claim logic — grepping the built chunks for
 * `sellerzone|supplier.meesho|seller.snapdeal` returns nothing. So obfuscating
 * it traded a working UI for no protection at all, and 19 MB of framework code
 * is exactly the kind of input these transforms destabilise.
 *
 * It is not left bare: Vite already minifies it, so identifiers are mangled and
 * comments are gone. That is the appropriate level for code whose only secret
 * is its layout.
 *
 * ── THE GAP THAT ACTUALLY MATTERS, STILL OPEN ───────────────────────────────
 *
 * `@trackvid/automation-core` is where every marketplace flow lives — 17 files
 * matching the endpoints above — and it ships as PLAIN SOURCE. It is a
 * `dependency`, so electron-builder copies it into the asar; a previous build's
 * archive carries 425 of its files. It is loaded at runtime through
 * `createRequire` (automations/common/coreLoader.ts) by a computed path, so a
 * bundler cannot follow it and it can never arrive here inside `out/`.
 *
 * So: 100% of the obfuscation effort has been landing on code with none of the
 * IP, and 100% of the IP has been shipping in the clear.
 *
 * IT IS NOT FIXED HERE, DELIBERATELY. The core makes 139 calls to
 * `page.evaluate(fn)`, which serialises the function with `fn.toString()` and
 * runs the TEXT in a browser page that has none of this module's scope. Any
 * transform that hoists a literal out of one of those bodies — `stringArray`,
 * `transformObjectKeys`, `controlFlowFlattening` — throws `_0x… is not
 * defined` at runtime, against a live marketplace, from a build that tested
 * clean.
 *
 * A profile of identifier renaming alone (`stringArray: false`, no flattening,
 * no key transform, no self-defending) should survive that, because each
 * callback stays self-contained. It is not enabled because it cannot be
 * verified from a macOS checkout: proving it needs 139 puppeteer flows run
 * against real marketplaces, and the failure mode is a silently broken claim.
 * Two things must also change with it — `node_modules/@trackvid/automation-core`
 * is a SYMLINK to `packages/TrackVid-Automation-Core`, a git submodule, so
 * writing obfuscated files through it would corrupt the working checkout; the
 * rewrite has to happen on the packaged copy.
 *
 * AND WHAT ANY OF THIS IS WORTH. It makes a bundle unpleasant to read. It does
 * not make it unreadable — the code has to run, the string array decodes itself
 * at startup, and tools that reverse these transforms are public. The things
 * that actually protect this app are not shipping secrets and signing the build
 * so a modified copy cannot pose as it.
 */

const { readFile, readdir, writeFile } = require('node:fs/promises')
const { existsSync, readFileSync } = require('node:fs')
const { join, relative } = require('node:path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const ROOT = join(__dirname, '..')
const ENV_FILE = join(ROOT, '.env')

/** Minimal .env reader: KEY=value, optionally quoted, # starts a comment line. */
const loadEnvFile = () => {
  if (!existsSync(ENV_FILE)) return
  for (const rawLine of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim()
    // A real environment variable always wins over the file, so a one-off
    // override on the command line still works.
    if (key === '' || process.env[key] !== undefined) continue

    process.env[key] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
}

/**
 * Shared settings, and the ones deliberately left off:
 *
 *   `debugProtection` — a debugger loop. It would fight our own support path,
 *     and the packaged build already refuses devtools (windows/appMenu.ts).
 *   `disableConsoleOutput` — the app's whole support story is reading pino and
 *     userLogger output off an operator's machine.
 *   `transformObjectKeys` — the preload hands a fixed object shape across the
 *     context bridge, and the renderer reads it by name.
 *   `renameGlobals` — the main bundle is CJS and touches `process`, `require`
 *     and `__dirname` by name.
 *   `selfDefending`, `controlFlowFlattening`, `deadCodeInjection` — the
 *     transforms that rewrite LOGIC rather than names and strings. Flattening
 *     re-picks its sites on every build, which is how `cb?.()` lost its guard
 *     and broke Re-capture in v0.0.6 on a build that tested clean. What is left
 *     — renaming plus an rc4 string array — changes no behaviour, so the
 *     packaged app runs as the plain build does. Cost: control flow reads
 *     straight through, and a reformatted bundle no longer refuses to run.
 */
const base = {
  compact: true,
  simplify: true,
  numbersToExpressions: true,
  stringArray: true,
  // EVERY string, not three in four. This was 0.75 while the renderer was a
  // target, where a full pass on 19 MB of framework code was not affordable.
  // Both remaining bundles are small and run once at startup, so the partial
  // pass bought nothing and left a quarter of the strings sitting in plain
  // text — including, in main, the marketplace paths coreLoader requires by
  // name.
  stringArrayThreshold: 1,
  // rc4 RATHER THAN base64, and splitStrings in front of it — carried over from
  // the vite plugin this step replaced, so removing the plugin did not weaken
  // anything. base64 is an encoding, not a cipher: `base64 -d` over the array
  // hands back every URL and endpoint path. rc4 needs the decoder to be driven.
  // Splitting long literals into 10-character chunks first means even a
  // recovered array does not reassemble into readable paths for free.
  //
  // Both cost startup time, which is affordable here and was not in a 19 MB
  // renderer: these two bundles are ~340 KB of Node code parsed once at launch.
  stringArrayEncoding: ['rc4'],
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  transformObjectKeys: false,
  renameGlobals: false,
  sourceMap: false
}

/*
 * BOTH TARGETS ARE NODE: no CSP, no framework re-entering these modules, no
 * emotion injecting styles from inside them. The renderer, which had none of
 * those guarantees, is no longer here — see the note at the top of this file.
 */
const TARGETS = [
  { dir: 'out/main', options: { ...base, target: 'node' } },
  { dir: 'out/preload', options: { ...base, target: 'node' } }
]

/** Everything under `dir`, recursively — the renderer's code lives in assets/. */
const jsFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => join(entry.parentPath ?? dir, entry.name))
}

const run = async () => {
  loadEnvFile()

  const obfuscateEnv = (process.env.TRACKVID_OBFUSCATE ?? process.env.OBFUSCATE ?? 'true').trim().toLowerCase()
  if (obfuscateEnv === 'false' || obfuscateEnv === '0' || obfuscateEnv === 'off') {
    const matchedKey = process.env.TRACKVID_OBFUSCATE !== undefined ? 'TRACKVID_OBFUSCATE' : 'OBFUSCATE'
    console.log(`obfuscate — skipped (${matchedKey}=${process.env[matchedKey]})`)

    return
  }

  for (const { dir, options } of TARGETS) {
    const full = join(ROOT, dir)

    if (!existsSync(full)) {
      throw new Error(`obfuscate — ${dir} is missing. Run this after the build.`)
    }

    const files = await jsFiles(full)

    if (files.length === 0) throw new Error(`obfuscate — ${dir} held no .js files`)

    let before = 0
    let after = 0

    for (const file of files) {
      const source = await readFile(file, 'utf8')

      // controlFlowFlattening drops the guard from some `cb?.(x)` calls and
      // ships `cb(x)` — a crash only the packaged app sees. electron.vite.config
      // lowers optional chaining for this reason; a bundle that still has one
      // means that setting was lost, and the build stops here instead.
      if (/\?\.\(/.test(source)) {
        throw new Error(
          `obfuscate — ${relative(ROOT, file)} still contains an optional call (?.()). ` +
            "Keep esbuild's `supported: { 'optional-chain': false }` in electron.vite.config.ts."
        )
      }
      // Throws on a parse failure rather than leaving the file as it was: a
      // half-obfuscated build that looks like a success is the failure worth
      // avoiding.
      const result = JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode()

      if (!result) throw new Error(`obfuscate — empty output for ${relative(ROOT, file)}`)

      before += source.length
      after += result.length

      await writeFile(file, result, 'utf8')
    }

    const growth = before > 0 ? Math.round((after / before) * 10) / 10 : 0

    console.log(
      `obfuscate — ${dir}: ${files.length} file(s), ` +
        `${Math.round(before / 1024)} KB to ${Math.round(after / 1024)} KB (${growth}x)`
    )
  }
}

run().catch((error) => {
  console.error(`\n  ${error.message}\n`)
  process.exit(1)
})
