import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import ts from 'typescript-eslint'
import { noRawObjectArgumentsRule } from '../../eslint.config.js'

const config = {
  languageOptions: {
    parser: ts.parser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  plugins: {
    'nook-typed-api': {
      rules: {
        'no-raw-object-arguments': noRawObjectArgumentsRule,
      },
    },
  },
  rules: {
    'nook-typed-api/no-raw-object-arguments': 'error',
  },
}

function lint(source) {
  return new Linter().verify(source, config)
}

describe('typed API named arguments', () => {
  test('rejects a named object literal without an explicit type', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      const args = { name: 'Nook' }
      consume(args)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('accepts an explicitly typed named object argument', () => {
    const messages = lint(`
      type ConsumeArgs = { name: string }
      declare function consume(value: ConsumeArgs): void
      const args: ConsumeArgs = { name: 'Nook' }
      consume(args)
    `)

    expect(messages).toEqual([])
  })

  test('rejects object literals expanded from an inline spread array', () => {
    const messages = lint(`
      declare function consume(...values: { name: string }[]): void
      consume(...[{ name: 'Nook' }])
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })
})
