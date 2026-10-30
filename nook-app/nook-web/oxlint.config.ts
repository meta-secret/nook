import svelte from "eslint-plugin-svelte";
import { defineConfig } from "oxlint";
import {
  concreteObjectTypeRules,
  lintIgnorePatterns,
  oxlintRules,
  typedApiRules,
  typedApiSourceFiles,
  untrustedInputAdapterFiles,
  untrustedInputAdapterRules,
} from "./typed-api-rules.js";

// Oxlint lints every authored .ts/.js/.mjs/.cjs web file. TypeScript 7
// (tsgolint) runs the type-aware rules in each file's nearest including
// tsconfig.json; `jsconfig.json` routes every other file to
// `tsconfig.eslint.json`. ESLint keeps only `.svelte` files, and
// `named-success-contract-check.ts` runs the type-aware success-contract rule
// on TypeScript 7. Each rule below carries the options ESLint resolved for
// it, because several oxlint defaults differ. ESLint's `no-octal` and
// `no-dupe-args` have no oxlint rule: every linted file is strict-mode module
// code, where the oxc parser rejects both as syntax errors.

const scriptFiles = ["**/*.{js,mjs,cjs}"];
const typeScriptFiles = ["**/*.{ts,mts,cts,tsx}"];

// `svelte.configs["flat/recommended"]` applies its rules to every file, so
// TypeScript and JavaScript modules keep them. Two rules need the
// TypeScript 6 program from typescript-eslint and only act on components:
// they stay with ESLint for `.svelte`.
const svelteRulesNeedingTypeScriptProgram = new Set([
  "svelte/no-unused-props",
  "svelte/no-navigation-without-resolve",
]);
const svelteRecommendedRules = Object.fromEntries(
  svelte.configs["flat/recommended"]
    .flatMap(({ rules = {} }) => Object.entries(rules))
    .filter(
      ([ruleName]) =>
        ruleName.startsWith("svelte/") &&
        !svelteRulesNeedingTypeScriptProgram.has(ruleName),
    ),
);

export default defineConfig({
  options: { typeAware: true },
  plugins: ["eslint", "typescript"],
  categories: {
    correctness: "off",
    suspicious: "off",
    pedantic: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
  },
  jsPlugins: [
    { name: "svelte", specifier: "eslint-plugin-svelte" },
    "eslint-plugin-no-unsanitized",
    "./oxlint-nook-typed-api-plugin.js",
    "./oxlint-restricted-syntax-plugin.js",
  ],
  ignorePatterns: [...lintIgnorePatterns, "**/*.svelte"],
  env: { builtin: true, browser: true },
  rules: {
    // @eslint/js recommended, as ESLint resolved it for every file.
    "eslint/for-direction": "error",
    "eslint/no-async-promise-executor": "error",
    "eslint/no-case-declarations": "error",
    "eslint/no-compare-neg-zero": "error",
    "eslint/no-cond-assign": ["error", "except-parens"],
    "eslint/no-constant-binary-expression": [
      "error",
      { checkRelationalComparisons: false },
    ],
    "eslint/no-constant-condition": [
      "error",
      { checkLoops: "allExceptWhileTrue" },
    ],
    "eslint/no-control-regex": "error",
    "eslint/no-debugger": "error",
    "eslint/no-delete-var": "error",
    "eslint/no-dupe-else-if": "error",
    "eslint/no-duplicate-case": "error",
    "eslint/no-empty": ["error", { allowEmptyCatch: false }],
    "eslint/no-empty-character-class": "error",
    "eslint/no-empty-pattern": [
      "error",
      { allowObjectPatternsAsParameters: false },
    ],
    "eslint/no-empty-static-block": "error",
    "eslint/no-ex-assign": "error",
    "eslint/no-extra-boolean-cast": "error",
    // ESLint matches its default fallthrough comment anywhere in a comment;
    // oxlint anchors its default, so pass ESLint's pattern explicitly.
    "eslint/no-fallthrough": [
      "error",
      {
        allowEmptyCase: false,
        commentPattern: "(?iu)falls?\\s?through",
        reportUnusedFallthroughComment: false,
      },
    ],
    "eslint/no-global-assign": ["error", { exceptions: [] }],
    "eslint/no-invalid-regexp": "error",
    "eslint/no-irregular-whitespace": [
      "error",
      {
        skipComments: false,
        skipJSXText: false,
        skipRegExps: false,
        skipStrings: true,
        skipTemplates: false,
      },
    ],
    "eslint/no-loss-of-precision": "error",
    "eslint/no-misleading-character-class": ["error", { allowEscape: false }],
    "eslint/no-nonoctal-decimal-escape": "error",
    "eslint/no-prototype-builtins": "error",
    "eslint/no-regex-spaces": "error",
    "eslint/no-self-assign": ["error", { props: true }],
    "eslint/no-shadow-restricted-names": ["error", { reportGlobalThis: true }],
    "eslint/no-sparse-arrays": "error",
    "eslint/no-unassigned-vars": "error",
    "eslint/no-unexpected-multiline": "error",
    "eslint/no-unsafe-finally": "error",
    "eslint/no-unsafe-optional-chaining": [
      "error",
      { disallowArithmeticOperators: false },
    ],
    "eslint/no-unused-labels": "error",
    "eslint/no-unused-private-class-members": "error",
    "eslint/no-useless-assignment": "error",
    "eslint/no-useless-backreference": "error",
    "eslint/no-useless-catch": "error",
    "eslint/no-useless-escape": ["error", { allowRegexCharacters: [] }],
    "eslint/preserve-caught-error": ["error", { requireCatchParameter: false }],
    "eslint/require-yield": "error",
    "eslint/use-isnan": [
      "error",
      { enforceForIndexOf: false, enforceForSwitchCase: true },
    ],
    "eslint/valid-typeof": ["error", { requireStringLiterals: false }],

    // typescript-eslint recommended, for every file.
    "typescript/ban-ts-comment": "error",
    "eslint/no-array-constructor": "error",
    "typescript/no-duplicate-enum-values": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-extra-non-null-assertion": "error",
    "typescript/no-misused-new": "error",
    "typescript/no-namespace": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/no-require-imports": "error",
    "typescript/no-this-alias": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unsafe-function-type": "error",
    "eslint/no-unused-expressions": [
      "error",
      {
        allowShortCircuit: false,
        allowTaggedTemplates: false,
        allowTernary: false,
      },
    ],
    // An object option drops oxlint's default `^_` ignore patterns, which
    // typescript-eslint does not have.
    "eslint/no-unused-vars": [
      "error",
      {
        vars: "all",
        args: "after-used",
        caughtErrors: "all",
        ignoreRestSiblings: false,
      },
    ],
    "typescript/no-wrapper-object-types": "error",
    "typescript/prefer-as-const": "error",
    "typescript/prefer-namespace-keyword": "error",
    "typescript/triple-slash-reference": "error",

    ...svelteRecommendedRules,

    "no-unsanitized/method": "error",
    "no-unsanitized/property": "error",

    // Type-aware security and soundness rules, for every file.
    ...oxlintRules({
      "no-restricted-syntax": typedApiRules["no-restricted-syntax"],
    }),
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/await-thenable": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/switch-exhaustiveness-check": [
      "error",
      { considerDefaultExhaustiveForUnions: false },
    ],
  },
  overrides: [
    {
      // @eslint/js recommended rules that typescript-eslint turns off for
      // TypeScript, where the compiler reports them.
      files: scriptFiles,
      rules: {
        "eslint/constructor-super": "error",
        "eslint/getter-return": ["error", { allowImplicit: false }],
        "eslint/no-class-assign": "error",
        "eslint/no-const-assign": "error",
        "eslint/no-dupe-class-members": "error",
        "eslint/no-dupe-keys": "error",
        "eslint/no-func-assign": "error",
        "eslint/no-import-assign": "error",
        "eslint/no-new-native-nonconstructor": "error",
        "eslint/no-obj-calls": "error",
        "eslint/no-redeclare": ["error", { builtinGlobals: true }],
        "eslint/no-setter-return": "error",
        "eslint/no-this-before-super": "error",
        "eslint/no-undef": ["error", { typeof: false }],
        "eslint/no-unreachable": "error",
        "eslint/no-unsafe-negation": [
          "error",
          { enforceForOrderingRelations: false },
        ],
        "eslint/no-with": "error",
      },
    },
    {
      // typescript-eslint's eslint-recommended additions for TypeScript.
      files: typeScriptFiles,
      rules: {
        "eslint/no-var": "error",
        "eslint/prefer-const": [
          "error",
          { destructuring: "any", ignoreReadBeforeAssign: false },
        ],
        "eslint/prefer-rest-params": "error",
        "eslint/prefer-spread": "error",
      },
    },
    {
      files: ["nook-web-extension/src/**", "src/**"],
      env: { webextensions: true },
      globals: { chrome: "readonly" },
    },
    {
      files: [
        "./*.js",
        "**/eslint.config.js",
        "**/svelte.config.js",
        "**/scripts/**/*.{js,mjs,cjs}",
        "**/e2e/**/*.{js,mjs,cjs}",
      ],
      env: { node: true },
    },
    {
      files: ["**/*.ts"],
      rules: oxlintRules(concreteObjectTypeRules),
    },
    {
      files: typedApiSourceFiles,
      rules: oxlintRules(typedApiRules),
    },
    {
      files: untrustedInputAdapterFiles,
      rules: oxlintRules(untrustedInputAdapterRules),
    },
    {
      files: ["**/tests/**", "**/e2e/**"],
      rules: { "no-unsanitized/property": "off" },
    },
  ],
});
