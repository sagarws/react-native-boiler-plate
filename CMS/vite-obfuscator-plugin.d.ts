import type { ObfuscatorOptions } from 'javascript-obfuscator'
import type { Plugin } from 'vite'

/**
 * Post-build JavaScript obfuscation plugin. Runs in `writeBundle` (build only)
 * and rewrites the emitted `.js` files under out/renderer, out/preload and
 * out/main in place. `options` is passed straight to javascript-obfuscator.
 */
export function obfuscatorPlugin(options?: ObfuscatorOptions): Plugin

export default obfuscatorPlugin
