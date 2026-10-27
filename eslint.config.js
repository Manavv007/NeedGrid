// Root ESLint flat config. C adds React rules inside apps/web (own config block or file).
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/drizzle/**",
      "apps/web/public/mockServiceWorker.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      // Money safety: parseFloat on money is banned project-wide (use packages/shared/src/money.ts).
      "no-restricted-globals": ["error", { name: "parseFloat", message: "Use money helpers from @needgrid/shared." }],
    },
  },
  prettier,
);
