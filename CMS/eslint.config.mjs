import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'node_modules/**',
      // Vendored submodule — @trackvid/automation-core is linted in its own repo,
      // and its generated types/ are not part of any tsconfig here, so the
      // type-checked rules cannot parse them.
      'packages/**',
      // A developer's scratch script against the live portal — not app code.
      'test.snapdeal.js'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always']
    }
  },

  {
    files: ['electron/main/**/*.ts', 'electron/preload/**/*.ts', 'shared/**/*.ts', 'tests/**/*.ts', 'tests/**/*.cjs', 'scripts/**/*.cjs', '*.ts'],
    languageOptions: { globals: globals.node }
  },

  {
    files: ['electron/renderer/**/*.{ts,tsx}'],
    // v7 keeps the eslintrc-style config under `configs.recommended`; the flat
    // config lives under `configs.flat.recommended`.
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      // The renderer must never reach Node.js directly - it talks to the main
      // process through the preload bridge only.
      'no-restricted-globals': [
        'error',
        { name: 'require', message: 'The renderer must use window.trackvid (preload bridge) instead of Node APIs.' },
        { name: 'process', message: 'Use window.trackvid.platform instead of process in the renderer.' }
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'path', 'child_process', 'os', 'electron'], message: 'Node/Electron APIs are forbidden in the renderer. Use the preload bridge.' }
          ]
        }
      ]
    }
  },

  /*
   * The ported design system is VENDORED CODE, not ours.
   *
   * `@core`, `@menu`, `@layouts` and `configs` are copied file for file from
   * TrackVid-Monitor so the two products render from the same theme object
   * rather than from two drifting approximations of it. They were written
   * against Monitor's ESLint config, which is looser than this one in exactly
   * the places a MUI theme has to be loose: a `components` override object is
   * typed `any` by MUI itself, and a styled() factory returns one.
   *
   * Editing them to satisfy our rules would make every future re-sync with
   * Monitor a merge conflict, for no gain in a file nobody here writes. So the
   * type-safety rules are off HERE and nowhere else — anything under
   * electron/renderer that is ours keeps them.
   */
  {
    files: [
      'electron/renderer/@core/**/*.{ts,tsx}',
      'electron/renderer/@menu/**/*.{ts,tsx}',
      'electron/renderer/@layouts/**/*.{ts,tsx}',
      'electron/renderer/configs/**/*.{ts,tsx}',
      'electron/renderer/theme/muiAugmentation.ts'
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-extra-boolean-cast': 'off',
      /*
       * The menu measures and stores layout in effects — a nav that knows
       * whether it is collapsed, hovered or past a breakpoint cannot do that
       * from render alone. These two rules are right for code we write and
       * would mean rewriting the internals of a component we want to be able
       * to re-copy from Monitor.
       */
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off'
    }
  },

  /*
   * Create Claim is a PORT, and it has to stay one.
   *
   * `pages/claims/create` is TrackVid-FE's `/cms/create` — the same eleven
   * platform forms, the same submit, the same field names — brought over so
   * that a claim filed from the desktop and a claim filed from the web are the
   * same document. The two must not drift, and the way to keep them from
   * drifting is to keep the files comparable: when a rule changes on the web
   * form, the change should be readable as a diff against this one.
   *
   * The FE compiles under a looser config, and the difference is concentrated
   * in one place — the form object. Formik types `values`, `errors` and
   * `touched` as open records, so every nested read is `(formik.errors as any)
   * ?.otherClaimDetails?.domestic`, and there are several hundred of them.
   * Making each one type-safe is a permanent local diff over the whole tree in
   * exchange for nothing: the shapes are pinned by `ICms` in shared/, which the
   * main process and the backend payload are both built from, and THAT file is
   * fully checked.
   *
   * So the same rules the vendored design system turns off are off here, and
   * nowhere else. Everything outside this folder keeps them.
   */
  {
    files: ['electron/renderer/pages/claims/create/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      /*
       * The form is driven by effects — an AWB settles and the master row is
       * fetched, a platform changes and the bundle resets, a claim loads and
       * twenty fields are written. That is what the screen does, and these two
       * rules describe a component that does not do it.
       */
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off'
    }
  },

  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-unsafe-assignment': 'off' } },

  // The end-to-end harness is a standalone CommonJS CLI script: require() and
  // console output are the correct idioms there, not policy violations.
  {
    files: ['tests/e2e/**/*.cjs', 'scripts/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off'
    }
  },

  // Plain-JS config files are parsed for correctness but not type-checked: the
  // plugins they import ship no usable types, which would otherwise produce
  // unsafe-any errors about ESLint's own configuration.
  {
    files: ['**/*.mjs', '**/*.js', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked]
  },

  // The obfuscator plugin is a build-time Node script, same category as the
  // packaging scripts under scripts/: it reads the build output from disk and
  // logs its progress, so it gets Node globals and may use console.
  {
    files: ['vite-obfuscator-plugin.js'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' }
  }
)
