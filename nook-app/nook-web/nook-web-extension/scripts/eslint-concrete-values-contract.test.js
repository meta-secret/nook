import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import ts from 'typescript-eslint'
import {
  typedApiRules,
  untrustedInputAdapterRules,
} from '../../typed-api-rules.js'

function lint(args) {
  const config = {
    languageOptions: {
      parser: ts.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': ts.plugin,
    },
    rules: args.rules,
  }
  return new Linter().verify(args.source, config)
}

function concreteValueRule(rules) {
  return {
    '@typescript-eslint/no-restricted-types':
      rules['@typescript-eslint/no-restricted-types'],
  }
}

describe('typed API concrete values', () => {
  test('rejects generic object annotations in domain code', () => {
    const args = {
      source: 'declare function receive(message: object): void',
      rules: concreteValueRule(typedApiRules),
    }
    const messages = lint(args)

    expect(messages.map((message) => message.ruleId)).toContain(
      '@typescript-eslint/no-restricted-types',
    )
  })

  test('rejects generic object annotations in untrusted input adapters', () => {
    const args = {
      source: 'declare function decode(message: object): void',
      rules: concreteValueRule(untrustedInputAdapterRules),
    }
    const messages = lint(args)

    expect(messages.map((message) => message.ruleId)).toEqual([
      '@typescript-eslint/no-restricted-types',
    ])
  })

  test('allows unknown only in an untrusted input adapter', () => {
    const args = {
      source: 'declare function decode(message: unknown): void',
      rules: concreteValueRule(untrustedInputAdapterRules),
    }

    expect(lint(args)).toEqual([])
  })

  test('accepts a concrete message union', () => {
    const args = {
      source: `
        enum RuntimeMessageKind { Query = 'query', Commit = 'commit' }
        type RuntimeMessage =
          | { type: RuntimeMessageKind.Query; query: string }
          | { type: RuntimeMessageKind.Commit; secretId: string }
        declare function receive(message: RuntimeMessage): void
      `,
      rules: concreteValueRule(typedApiRules),
    }

    expect(lint(args)).toEqual([])
  })
})
