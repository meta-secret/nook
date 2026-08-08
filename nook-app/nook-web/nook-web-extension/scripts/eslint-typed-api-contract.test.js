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

  test('rejects untyped names initialized by object-producing expressions', () => {
    const messages = lint(`
      declare const flag: boolean
      declare function consume(value: { name: string } | false): void
      const conditionalArgs = flag ? { name: 'Nook' } : { name: 'Vault' }
      const logicalArgs = flag && { name: 'Nook' }
      const sequenceArgs = (flag, { name: 'Nook' })
      consume(conditionalArgs)
      consume(logicalArgs)
      consume(sequenceArgs)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
      'typedArgument',
      'typedArgument',
    ])
  })

  test('rejects an untyped named argument that aliases an object', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      const original = { name: 'Nook' }
      const firstAlias = original
      const args = firstAlias
      consume(args)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('rejects an untyped named argument assigned after declaration', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      let args
      args = { name: 'Nook' }
      consume(args)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
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

  test('rejects object literals expanded from a named spread array', () => {
    const messages = lint(`
      declare function consume(...values: { name: string }[]): void
      const packed = [{ name: 'Nook' }]
      consume(...packed)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('rejects object literals assigned to a spread array name', () => {
    const messages = lint(`
      declare function consume(...values: { name: string }[]): void
      let packed
      packed = [{ name: 'Nook' }]
      consume(...packed)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('rejects object literals nested in call-site expressions', () => {
    const messages = lint(`
      declare const flag: boolean
      declare function consume(value: { name: string }): void
      consume(flag ? { name: 'Nook' } : { name: 'Vault' })
      consume(flag && { name: 'Nook' })
      consume((flag, { name: 'Nook' }))
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
      'namedArgument',
      'namedArgument',
      'namedArgument',
    ])
  })
})
