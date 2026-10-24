import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["infra/linux-test/runtime.mjs", "apps/worker/.candidate-*/**","**/node_modules/**", "**/.next/**", "**/.next-playwright-*/**", "**/.next-stale-*/**", "**/dist/**", "**/generated/**", "**/next-env.d.ts", ".agents/**", ".codex/**", ".kilo/**", "**/.impeccable/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // These diagnostic entry points run in Node, including URL and AbortSignal.
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: {
    process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly", AbortSignal: "readonly",
  } } },
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  { files: ["apps/web/src/**/*.tsx", "packages/ui/**"], rules: {
    "no-restricted-imports": ["error", { patterns: ["@aia/database", "@aia/database/*", "**/packages/database/**"] }]
  }}
);
