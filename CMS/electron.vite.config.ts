import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
const sharedAlias = { '@shared': resolve(__dirname, 'shared') }

/*
 * THERE IS NO OBFUSCATION IN THIS FILE, AND THERE MUST NOT BE.
 *
 * It used to run here as a vite plugin on all three targets, and that broke two
 * things at once.
 *
 * 1. IT KILLED THE SECRET GATE. `npm run build` is
 *
 *        verify -> electron-vite build -> verify:secrets -> obfuscate
 *
 *    and verify:secrets works by grepping the emitted bundles for the literal
 *    values in .env. A plugin obfuscates DURING step two, so the check ran on
 *    already-encoded output — and with `stringArrayThreshold: 1` plus rc4, no
 *    string literal survives anywhere. The gate could no longer fail. It
 *    reported "no credential inlined" on every build because it had nothing
 *    left to look at, which is worse than having no gate at all.
 *
 * 2. IT OBFUSCATED THE RENDERER, TWICE OVER. The plugin ran on out/renderer,
 *    then scripts/obfuscate.cjs ran on main and preload again afterwards —
 *    321 KB of main became 1688 KB and then 5445 KB, for one build's worth of
 *    protection. The renderer pass is the one that left MUI unstyled on the
 *    login screen and a blank window after sign-in.
 *
 * scripts/obfuscate.cjs is now the only place it happens: after verify:secrets
 * has seen plain output, on main and preload only. Its header carries the
 * measurements and the reasoning, including why the renderer is left to Vite's
 * minifier and where the real IP actually sits.
 */

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devPort = Number(env.RENDERER_VITE_DEV_PORT || env.VITE_DEV_PORT || 5173)
  /*
   * IMPERSON_LOGIN — whether this build offers "sign in as a user id".
   *
   * An unprefixed key, so electron-vite would expose it to neither side; it is
   * read once here and inlined into BOTH, because hiding the tab is not enough:
   * the main process refuses the call too. Only the exact string "true" turns
   * it on — a missing line ships a build without it.
   */
  const impersonLogin = { __IMPERSON_LOGIN__: JSON.stringify(env.IMPERSON_LOGIN?.trim() === 'true') }
  /*
   * DEV_MODE_PERSIST — whether developer mode survives a restart. Main process
   * only (preferences.service reads it at launch). Unprefixed and inlined for
   * the same reason as IMPERSON_LOGIN; only the exact string "true" keeps it.
   */
  const devModePersist = { __DEV_MODE_PERSIST__: JSON.stringify(env.DEV_MODE_PERSIST?.trim() === 'true') }
  /*
   * AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS — when a running process (Create
   * Ticket, Auto claim, Refill, an import…) meets an expired login on a platform
   * with auto-login on, re-capture it by script and carry on instead of stopping
   * at the re-capture dialog. Both sides need it: the renderer's pre-flight
   * dialog and the main process's sign-in policy. Spelled as it is set in .env;
   * the correctly spelled RUNNING is accepted too. Only the exact "true" counts.
   */
  const autoSessionCapture = {
    __AUTO_SESSION_CAPTURE__: JSON.stringify(
      (env.AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS ?? env.AUTO_SESSION_CAPTURE_ON_RUNNING_PROCESS)?.trim() === 'true'
    )
  }
  /*
   * OPTIONAL CHAINING IS LOWERED IN THE TWO BUNDLES scripts/obfuscate.cjs TOUCHES.
   *
   * javascript-obfuscator 4.2.2's controlFlowFlattening rewrites some calls into
   * proxy functions — `cb?.(x)` becomes `proxy(cb, x)` → `cb(x)` — and drops
   * the `?.` guard. Which sites it picks changes from build to build, so dev
   * works and a packaged build fails at random: "_0x… is not a function" from
   * loginLocally's `onProgress?.()` broke every Re-capture in v0.0.6. Lowered
   * to `cb == null ? void 0 : cb(x)` here, there is nothing left to lose.
   * obfuscate.cjs refuses a bundle that still contains one.
   */
  const lowerOptionalChain = { supported: { 'optional-chain': false } }
  /*
   * MAX_CLAIM_ATTEMPTS — the claim retry cap, owned by the core
   * (common/constants.js): "unlimited" or a whole number. Read here at build
   * time because the renderer cannot load the core (it reads process.env at
   * module scope), and the Claims page's checkboxes need the same cap as the
   * automation. Inlined as it stands; `claimAttemptLimit` in
   * shared/constants/claims.ts decides what it means.
   */
  const coreConstants = createRequire(resolve(__dirname, 'package.json'))(
    '@trackvid/automation-core/common/constants'
  ) as { MAX_CLAIM_ATTEMPTS?: unknown }
  const claimAttempts = { __MAX_CLAIM_ATTEMPTS__: JSON.stringify(coreConstants.MAX_CLAIM_ATTEMPTS ?? null) }

  return {
    main: {
      define: { ...impersonLogin, ...devModePersist, ...autoSessionCapture, ...claimAttempts },
      esbuild: lowerOptionalChain,
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: { ...sharedAlias, '@main': resolve(__dirname, 'electron/main') } },
      build: {
        outDir: 'out/main',
        minify: 'esbuild',
        lib: { entry: resolve(__dirname, 'electron/main/main.ts') },
        rollupOptions: { output: { format: 'cjs', entryFileNames: 'main.js' } }
      }
    },
    preload: {
      define: claimAttempts,
      esbuild: lowerOptionalChain,
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: sharedAlias },
      build: {
        outDir: 'out/preload',
        minify: 'esbuild',
        // Must stay CommonJS: sandboxed preload scripts cannot be ES modules.
        lib: { entry: resolve(__dirname, 'electron/preload/preload.ts') },
        rollupOptions: { output: { format: 'cjs', entryFileNames: 'preload.js' } }
      }
    },
    renderer: {
      root: resolve(__dirname, 'electron/renderer'),
      define: { ...impersonLogin, ...autoSessionCapture, ...claimAttempts },
      plugins: [react(), tailwindcss()],
      /*
       * Monitor's own aliases, kept spelled the same way.
       *
       * The design system is ported file for file, and every one of those files
       * imports through `@core/…`, `@menu/…`, `@layouts/…` or `@configs/…`.
       * Rewriting those imports to relative paths would be a diff over every
       * ported file that makes the next port from Monitor harder to compare.
       */
      resolve: {
        alias: {
          ...sharedAlias,
          '@renderer': resolve(__dirname, 'electron/renderer'),
          '@core': resolve(__dirname, 'electron/renderer/@core'),
          '@layouts': resolve(__dirname, 'electron/renderer/@layouts'),
          '@menu': resolve(__dirname, 'electron/renderer/@menu'),
          '@configs': resolve(__dirname, 'electron/renderer/configs'),
          '@': resolve(__dirname, 'electron/renderer'),
          /*
           * The two Next modules the ported menu imports, pointed at shims.
           *
           * Next is NOT a dependency of this app and never will be. Monitor's
           * menu components decide which item is current by comparing their
           * `href` with `usePathname()`, and they render each item as a
           * `next/link`. Aliasing those two specifiers is what lets those files
           * stay byte-identical to Monitor's — the alternative is editing them
           * on every re-sync, forever, to say the same thing a different way.
           *
           * See electron/renderer/navigation/ for what they actually do.
           */
          'next/navigation': resolve(__dirname, 'electron/renderer/navigation/next-navigation.ts'),
          'next/link': resolve(__dirname, 'electron/renderer/navigation/next-link.tsx'),
          // Three hooks, none of them worth a package with a vulnerable
          // `js-cookie` underneath it. See the shim.
          'react-use': resolve(__dirname, 'electron/renderer/@core/hooks/reactUseShim.ts')
        }
      },
      server: { port: devPort, strictPort: true },
      build: {
        outDir: resolve(__dirname, 'out/renderer'),
        emptyOutDir: true,
        // electron-vite leaves output unminified by default; the renderer is
        // parsed on every cold start, so minify it.
        minify: 'esbuild',
        sourcemap: false,
        chunkSizeWarningLimit: 800,
        rollupOptions: { input: resolve(__dirname, 'electron/renderer/index.html') }
      }
    }
  }
})
