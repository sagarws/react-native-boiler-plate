#!/usr/bin/env node
/*
 * Fails when a visual constant is written anywhere but styles/theme.css.
 *
 * WHY THIS EXISTS. The migration took 1,449 literals out of 57 components, and
 * every one of them was written by somebody with a good reason at the time.
 * Nothing stops the 1,450th except a check that runs on every build — the same
 * reason the app has a typechecker rather than a convention about types.
 *
 * WHAT COUNTS AS A LITERAL:
 *
 *   an inline colour            #0a0f22, rgb(...), rgba(...), oklch(...)
 *   a non-themed colour utility bg-amber-50, text-red-600 — ramps no theme
 *                               redefines, so they stay light on the dark theme
 *   a neutral utility           bg-white, text-slate-500 — themed, but they say
 *                               a COLOUR where the component means a ROLE
 *   an arbitrary size           text-[11px], max-w-[22rem] — a scale with an
 *                               exception in it is not a scale
 *
 * WHAT DOES NOT:
 *
 *   `[var(--token)]`            an arbitrary value that IS a token reference
 *   a transition property list  `transition-[width]` names a property
 *   a grid template             `grid-cols-[1fr_auto]` is structure
 *   a cursor keyword            `cursor-[inherit]`
 *   comments                    prose explaining why a class was replaced
 *   the allow-list below        each entry with a reason
 *
 * Node built-ins only, like every other script here.
 */
const { readdirSync, readFileSync, statSync } = require('node:fs')
const { join, relative } = require('node:path')

const ROOT = join(__dirname, '..')
const SOURCE = join(ROOT, 'electron', 'renderer')

/**
 * Lines that may hold a literal, each with the reason.
 *
 * Kept as `file:needle` rather than line numbers, which go stale on the next
 * edit above them.
 */
const ALLOWED = [
  {
    file: 'pages/claims/ClaimsPage.tsx',
    needle: 'dot:',
    why:
      'The status-tab dots mirror claimStatuses.js in @trackvid/automation-core, which mirrors ' +
      'the admin panel. They are shared DATA, not styling — the real values arrive over IPC and ' +
      'this array is only the first-paint fallback. Tokenising it would desynchronise it from ' +
      'the thing it exists to match.'
  },
  {
    file: 'pages/claims/create/platforms/registry.ts',
    needle: 'dot:',
    why:
      "A marketplace's own brand colour, shown beside its name in the platform picker. It is " +
      'DATA about the marketplace, not a choice this app makes — AJIO is teal wherever it is ' +
      'drawn, in this app and in TrackVid-FE, and tokenising it would mean the operator ' +
      "colour-scheme picker could repaint Flipkart's blue."
  },
  {
    file: 'pages/claims/create/tint.ts',
    needle: 'rgb(var(--mui-palette-',
    why:
      'The one place a colour function is written out, and it is a TOKEN reference rather than ' +
      'a literal — the same `rgb(var(--mui-palette-…Channel) / x)` form the ported design ' +
      "system uses in @core/styles. Every scrim and tint on the claim form goes through it, so " +
      'they all follow the colour scheme and the primary colour the operator picked.'
  },
  {
    file: 'pages/claims/create/imageToPdf.ts',
    needle: '#ffffff',
    why:
      'The page background a transparent PNG is flattened onto before it is encoded as JPEG, ' +
      'which has no alpha channel. It is a property of the PDF being generated, not of the UI — ' +
      'a claim photograph does not invert in dark mode.'
  },
  {
    file: 'pages/claims/create/CreateClaimPage.tsx',
    needle: 'CUSTOM_DOTS',
    why:
      "The rotation a company's OWN platform is coloured from — a D2C store, a marketplace " +
      'someone added on Integrations. There is no brand colour to look up and no meaning to ' +
      'the choice beyond telling two custom platforms apart.'
  },
  {
    file: 'pages/claims/create/PlatformIcon.tsx',
    needle: 'hsl(',
    why:
      'The badge colour derived from a platform name when nothing else supplies one. Same ' +
      'reason as CUSTOM_DOTS: it exists so two platforms do not collide, not to match anything.'
  },
  {
    file: 'pages/settings/ColourRows.tsx',
    needle: "'#000000'",
    why: 'The colour customiser itself, falling back when a seed cannot be parsed.'
  },
  {
    file: 'pages/settings/AppearanceCard.tsx',
    needle: 'swatch:',
    why: 'Preset swatches in the customiser. They ARE colour values — that is the feature.'
  },
  {
    file: 'pages/settings/AppearanceCard.tsx',
    needle: 'seeds: {',
    why: 'The palettes a preset reseeds with. Same reason as the swatch beside it.'
  },
  {
    file: 'pages/settings/AppearanceCard.tsx',
    needle: 'placeholder={',
    why: 'The example JSON shown in the import box, which has to look like a real palette.'
  }
]

const RULES = [
  {
    name: 'inline colour',
    test: /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\boklch\(/,
    hint: 'Use a semantic token from styles/theme.css.'
  },
  {
    name: 'non-themed colour utility',
    test:
      /\b(?:bg|text|ring|border|divide|from|to|via|placeholder|accent|fill|stroke|outline)-(?:amber|red|emerald|green|blue|sky|indigo|violet|purple|pink|rose|orange|yellow|lime|teal|cyan|fuchsia|gray|zinc|neutral|stone)-\d{2,3}\b/,
    hint: 'No theme redefines those ramps, so they keep their light-mode value on the dark theme.'
  },
  {
    name: 'neutral utility',
    test:
      /\b(?:bg|text|ring|border|divide|from|to|via|placeholder|accent|fill|stroke|outline|shadow|decoration|caret)-(?:slate|white|black)(?:-\d{2,3})?(?:\/\d{1,3})?\b/,
    hint: 'Say the role: bg-surface, text-muted, border-subtle, ring-focus.'
  },
  {
    name: 'arbitrary value',
    test: /\b[a-z-]+-\[(?!var\(--)[^\]]+\]/,
    hint: 'Use a scale step, or add a named token if it is a real design decision.'
  }
]

/** `transition-[…]`, `grid-cols-[…]` and friends name properties, not sizes. */
const STRUCTURAL = /\b(?:transition|cursor|grid-cols|grid-rows|grid-areas|will-change|content)-\[/

/*
 * The ported design system is not checked, and will not be.
 *
 * `@core`, `@menu`, `@layouts` and `configs` are vendored from TrackVid-Monitor
 * — they are MEANT to hold raw colours, since a MUI colour scheme is a list of
 * hex values. `theme`, `navigation`, `layout` and `preview` are ours but belong
 * to the same system, where a colour is written as
 * `rgb(var(--mui-palette-…-channel) / 0.85)`: a TOKEN reference that this
 * script's regex cannot tell from a literal. The old rule applies to what is
 * left of the app's own UI.
 *
 * P5 REPLACES THIS CHECK. Once the screens are on MUI, the rule worth enforcing
 * is "no raw hex outside the ported theme files", which is nearly the inverse
 * of what this script does today. Until then it keeps guarding the screens that
 * have not moved yet — deleting it early would let the old UI rot while the new
 * one is being built.
 */
const PORTED = [
  '@core',
  '@menu',
  '@layouts',
  'configs',
  'theme',
  'navigation',
  'layout',
  'preview'
]

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (dir === SOURCE && PORTED.includes(entry)) continue

    const path = join(dir, entry)

    if (statSync(path).isDirectory()) walk(path)
    else if (/\.tsx?$/.test(entry)) files.push(path)
  }
}
walk(SOURCE)

/**
 * Comments are prose. A file explaining why `text-white` was replaced must not
 * be the reason the build fails.
 */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line, lead) => lead + ' '.repeat(line.length - lead.length))

const findings = []

for (const path of files) {
  const rel = relative(SOURCE, path).split('\\').join('/')
  const lines = stripComments(readFileSync(path, 'utf8')).split('\n')

  lines.forEach((line, index) => {
    if (STRUCTURAL.test(line)) return

    const allowed = ALLOWED.find((entry) => rel.endsWith(entry.file) && line.includes(entry.needle))

    if (allowed) return

    for (const rule of RULES) {
      const match = rule.test.exec(line)

      if (match) {
        findings.push({ file: rel, line: index + 1, rule: rule.name, text: match[0], hint: rule.hint })
        break
      }
    }
  })
}

if (findings.length === 0) {
  console.log(`verify:tokens — ${files.length} files, no visual constants outside styles/theme.css`)
  process.exit(0)
}

console.error(`verify:tokens — ${findings.length} visual constant(s) outside styles/theme.css\n`)

for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.rule}: ${finding.text}`)
  console.error(`      ${finding.hint}\n`)
}

console.error('Every colour, size and radius belongs in electron/renderer/styles/theme.css.')
console.error('If one of these is genuinely data rather than styling, add it to ALLOWED in')
console.error('scripts/verify-tokens.cjs with the reason.')
process.exit(1)
