import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/.next-playwright-*/**", "**/.next-stale-*/**", "**/dist/**", "**/generated/**", "**/next-env.d.ts", ".agents/**", ".codex/**", ".kilo/**", "**/.impeccable/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  { files: ["apps/web/src/**/*.tsx", "packages/ui/**"], rules: {
    "no-restricted-imports": ["error", { patterns: ["@aia/database", "@aia/database/*", "**/packages/database/**"] }]
  }}
);
