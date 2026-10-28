// ESLint 10 looks up the config from each linted file's directory, so this file applies to apps/web
// even when `pnpm lint` runs from the repo root. It extends the root config (type imports, banned
// parseFloat, unused vars) and only adds browser + React rules on top.
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import rootConfig from "../../eslint.config.js";

export default [
  // Root ignore paths are relative to the repo root; repeat the web ones relative to this folder.
  { ignores: ["public/mockServiceWorker.js", "dist/**", "coverage/**"] },
  ...rootConfig,
  {
    files: ["src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
    ...jsxA11y.flatConfigs.recommended,
    plugins: { ...reactHooks.configs.flat.recommended.plugins, ...jsxA11y.flatConfigs.recommended.plugins },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Money safety: Number.parseFloat is the same function as the banned global.
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: "Use money helpers from @needgrid/shared." },
      ],
    },
    languageOptions: {
      ...jsxA11y.flatConfigs.recommended.languageOptions,
      globals: { ...globals.browser },
    },
  },
];
