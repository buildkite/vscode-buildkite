import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["out/**", ".vscode-test/**", "*.js", "**/*.js", "**/*.mjs"],
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      semi: ["error", "always"],
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2026,
      },
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
