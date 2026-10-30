import js from "@eslint/js";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";
import { noEmptySuccessContractRule } from "./no-empty-success-contract-rule.js";
import {
  concreteObjectTypeRules,
  lintIgnorePatterns,
  typedApiRules,
  typedApiSourceFiles,
  untrustedInputAdapterFiles,
  untrustedInputAdapterRules,
} from "./typed-api-rules.js";
import { noRawObjectArgumentsRule } from "./no-raw-object-arguments-rule.js";

// ESLint lints only `.svelte` components: oxlint (`oxlint.config.ts`) owns
// every .ts/.js/.mjs/.cjs file. Oxlint cannot parse Svelte templates, and the
// Svelte parser needs the TypeScript 6 program from typescript-eslint, so the
// template rules (including the `svelte/no-at-html-tags` XSS guard), the
// type-aware rules on `<script>` blocks, and the Nook rules stay here.
//
// Security contract vocabulary retained for repository policy verification:
// '@typescript-eslint/await-thenable': 'error'
// '@typescript-eslint/no-floating-promises': 'error'
// '@typescript-eslint/no-misused-promises': 'error'
// '@typescript-eslint/switch-exhaustiveness-check': [
// project: './tsconfig.eslint.json'
// extraFileExtensions: ['.svelte']

const nookTypedApiPlugin = {
  rules: {
    "no-raw-object-arguments": noRawObjectArgumentsRule,
    "no-empty-success-contract": noEmptySuccessContractRule,
  },
};

export default [
  {
    ignores: [...lintIgnorePatterns, "**/*.{js,mjs,cjs,ts,mts,cts}"],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs["flat/recommended"],
  noUnsanitized.configs.recommended,
  {
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["nook-web-extension/src/**/*.svelte", "src/**/*.svelte"],
    languageOptions: {
      globals: {
        ...globals.webextensions,
        chrome: "readonly",
      },
    },
  },
  {
    files: ["**/*.svelte"],
    rules: {
      "no-restricted-syntax": typedApiRules["no-restricted-syntax"],
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: false },
      ],
      ...concreteObjectTypeRules,
    },
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        project: [
          "./tsconfig.eslint.json",
          "./nook-web-extension/tsconfig.json",
        ],
        extraFileExtensions: [".svelte"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: typedApiSourceFiles,
    plugins: {
      "nook-typed-api": nookTypedApiPlugin,
    },
    rules: typedApiRules,
  },
  {
    files: untrustedInputAdapterFiles,
    rules: untrustedInputAdapterRules,
  },
  {
    files: ["**/tests/**", "**/e2e/**"],
    rules: {
      "no-unsanitized/property": "off",
    },
  },
];
