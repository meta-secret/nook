import webEslintConfig from './eslint.config.js'
import {
  typedApiRules,
  typedApiSourceFiles,
  untrustedInputAdapterFiles,
  untrustedInputAdapterRules,
} from './typed-api-rules.js'

const unrelatedWebLintRulesDisabled = webEslintConfig.map((configuration) => ({
  ...configuration,
  ...(configuration.rules
    ? {
        rules: Object.fromEntries(
          Object.keys(configuration.rules).map((ruleName) => [ruleName, 'off']),
        ),
      }
    : {}),
}))

export default [
  ...unrelatedWebLintRulesDisabled,
  {
    files: typedApiSourceFiles,
    rules: {
      '@typescript-eslint/no-restricted-types':
        typedApiRules['@typescript-eslint/no-restricted-types'],
      'nook-typed-api/no-empty-success-contract': 'error',
    },
  },
  {
    files: untrustedInputAdapterFiles,
    rules: untrustedInputAdapterRules,
  },
]
