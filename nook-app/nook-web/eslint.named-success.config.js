import webEslintConfig from "./eslint.config.js";
import { typedApiSourceFiles } from "./typed-api-rules.js";

// The success-contract rule alone, for `.svelte` files; TypeScript files use
// `named-success-contract-check.ts` on TypeScript 7.

const ruleDisabledWebConfig = webEslintConfig.map((configuration) => ({
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
  ...ruleDisabledWebConfig,
  {
    files: typedApiSourceFiles,
    rules: {
      "nook-typed-api/no-empty-success-contract": "error",
    },
  },
];
