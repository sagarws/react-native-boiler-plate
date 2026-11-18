import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Inlined by electron.vite.config.ts from IMPERSON_LOGIN. Tests run as a
  // build without the key: off.
  define: { __IMPERSON_LOGIN__: 'false', __DEV_MODE_PERSIST__: 'true', __AUTO_SESSION_CAPTURE__: 'false', __MAX_CLAIM_ATTEMPTS__: '3' },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@main': resolve(__dirname, 'electron/main'),
      /*
       * The renderer, for the parts of it that are plain logic.
       *
       * Most of the UI cannot be tested here — the environment is `node`, and
       * a component needs a DOM. But the claim form's rules, its per-platform
       * payload builders and its PDF writer are functions over data, and they
       * decide what reaches the marketplace. They are worth a test even though
       * the screen around them is not covered.
       */
      '@renderer': resolve(__dirname, 'electron/renderer'),
      /*
       * The ported shell, for its CLASS NAMES only.
       *
       * theme/vercelTheme.ts has to draw the navbar's border itself — the
       * shell that would normally do it is a copy of Monitor's and cannot be
       * edited — so it targets `verticalLayoutClasses.navbar` rather than
       * writing 'ts-vertical-layout-navbar' out and letting the two drift.
       * That import is what the theme's test then has to resolve.
       *
       * `@layouts/utils/layoutClasses` is a frozen object of strings: no React,
       * no DOM, nothing that needs a browser. This alias is NOT an invitation
       * to import shell components here — the note above still holds.
       */
      '@layouts': resolve(__dirname, 'electron/renderer/@layouts'),
      /*
       * For layout/navbarStyles.ts, which reads the compact content width so the
       * bar's content is capped where the page's is. `configs/themeConfig` is a
       * plain object with type-only imports — same terms as the alias above.
       */
      '@configs': resolve(__dirname, 'electron/renderer/configs')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true
  }
})
