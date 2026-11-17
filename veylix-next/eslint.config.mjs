import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Code converted from the original Veylix bundle. It keeps the original
    // runtime behaviour on purpose, so these rules report as warnings (a to-do
    // list) instead of failing the build. Files start with `// @ts-nocheck`
    // until they are typed; remove the banner from a file once it is typed.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-nocheck": false }],
      "@next/next/no-img-element": "off",
      "react/jsx-key": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/use-memo": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
