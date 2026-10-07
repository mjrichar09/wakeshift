import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "shots", "out"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-non-null-assertion": "off" } },
  // Playwright scripts run in Node and evaluate code in the page.
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
