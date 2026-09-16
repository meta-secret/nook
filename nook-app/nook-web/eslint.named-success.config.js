import webEslintConfig from './eslint.config.js'
import { typedApiSourceFiles } from './typed-api-rules.js'

const ruleDisabledWebConfig = webEslintConfig.map((configuration) => ({
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
  ...ruleDisabledWebConfig,
  {
    files: typedApiSourceFiles,
    rules: {
      'nook-typed-api/no-empty-success-contract': 'error',
    },
  },
]
