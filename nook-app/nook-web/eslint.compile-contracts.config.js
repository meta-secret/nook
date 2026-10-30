import webEslintConfig from "./eslint.config.js";
import {
  typedApiRules,
  typedApiSourceFiles,
  untrustedInputAdapterFiles,
  untrustedInputAdapterRules,
} from "./typed-api-rules.js";

// The compile-contract gate for `.svelte` files: `eslint.config.js` lints
// only Svelte, and `oxlint.compile-contracts.config.ts` plus
// `named-success-contract-check.ts` apply the same contracts to TypeScript.

const unrelatedWebLintRulesDisabled = webEslintConfig.map((configuration) => ({
  ...configuration,
  ...(configuration.rules
    ? {
        rules: Object.fromEntries(
          Object.keys(configuration.rules).map((ruleName) => [ruleName, "off"]),
        ),
      }
    : {}),
}));

export default [
  ...unrelatedWebLintRulesDisabled,
  {
    files: typedApiSourceFiles,
    rules: {
      "no-restricted-syntax": typedApiRules["no-restricted-syntax"],
      "@typescript-eslint/no-restricted-types":
        typedApiRules["@typescript-eslint/no-restricted-types"],
      "nook-typed-api/no-empty-success-contract": "error",
    },
  },
  {
    files: untrustedInputAdapterFiles,
    rules: untrustedInputAdapterRules,
  },
];
