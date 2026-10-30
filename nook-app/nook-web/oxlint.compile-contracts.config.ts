import { defineConfig } from "oxlint";
import {
  lintIgnorePatterns,
  oxlintRules,
  typedApiRules,
  typedApiSourceFiles,
  untrustedInputAdapterFiles,
  untrustedInputAdapterRules,
} from "./typed-api-rules.js";

// The compile image runs only the typed-API compile contracts on authored
// TypeScript: no type predicates and only concrete value types. The
// success-contract rule runs in `named-success-contract-check.ts`, and
// `eslint.compile-contracts.config.js` applies the same contracts to
// `.svelte` files.
export default defineConfig({
  plugins: ["typescript"],
  categories: { correctness: "off" },
  jsPlugins: ["./oxlint-restricted-syntax-plugin.js"],
  ignorePatterns: [...lintIgnorePatterns, "**/*.svelte"],
  overrides: [
    {
      files: typedApiSourceFiles,
      rules: oxlintRules({
        "no-restricted-syntax": typedApiRules["no-restricted-syntax"],
        "@typescript-eslint/no-restricted-types":
          typedApiRules["@typescript-eslint/no-restricted-types"],
      }),
    },
    {
      files: untrustedInputAdapterFiles,
      rules: oxlintRules(untrustedInputAdapterRules),
    },
  ],
});
