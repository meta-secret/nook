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

  test('rejects object literals expanded from nested spread arrays', () => {
    const messages = lint(`
      declare function consume(...values: { name: string }[]): void
      consume(...[...[{ name: 'Nook' }]])
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

  test('rejects untyped named values expanded from spread arrays', () => {
    const messages = lint(`
      declare function consume(...values: { name: string }[]): void
      const args = { name: 'Nook' }
      consume(...[args])
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
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

  test('rejects an object literal assigned inside a call argument', () => {
    const messages = lint(`
      type ConsumeArgs = { name: string }
      declare function consume(value: ConsumeArgs): void
      let args: ConsumeArgs
      consume((args = { name: 'Nook' }))
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('rejects object literals projected into call arguments', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      const container = { picked: { name: 'Vault' } }
      consume(({ picked: { name: 'Nook' } }).picked)
      consume(({ picked: { name: 'Nook' } })?.picked)
      consume(({ ...{ picked: { name: 'Nook' } } }).picked)
      consume(({ 0: { name: 'Nook' } })['0'])
      consume(([...[{ name: 'Nook' }]])[0])
      consume([{ name: 'Nook' }][0])
      consume([{ name: 'Nook' }]['0'])
      consume(container.picked)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
      'namedArgument',
      'namedArgument',
      'namedArgument',
      'namedArgument',
      'namedArgument',
      'namedArgument',
      'namedArgument',
    ])
  })

  test('classifies destructured bindings by their selected value', () => {
    const messages = lint(`
      declare function consumeCount(value: number): void
      declare function consumeArgs(value: { name: string }): void
      const { count } = { count: 1 }
      const { picked } = { picked: { name: 'Nook' } }
      consumeCount(count)
      consumeArgs(picked)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('classifies object-rest bindings as object values', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      const source = { name: 'Nook' }
      const { ...args } = source
      consume(args)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('projects destructuring assignment writes by binding', () => {
    const messages = lint(`
      declare function consumeCount(value: number): void
      declare function consumeArgs(value: { name: string }): void
      let count
      let picked
      ;({ count } = { count: 1 })
      ;({ picked } = { picked: { name: 'Nook' } })
      consumeCount(count)
      consumeArgs(picked)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('ignores object assignments after the argument call site', () => {
    const messages = lint(`
      declare function consumeCount(value: number): void
      let value
      value = 1
      consumeCount(value)
      value = { name: 'Nook' }
    `)

    expect(messages).toEqual([])
  })

  test('ignores object writes in nested execution scopes', () => {
    const messages = lint(`
      declare function consumeCount(value: number): void
      let value
      value = 1
      function unused(): void {
        value = { name: 'Nook' }
      }
      consumeCount(value)
    `)

    expect(messages).toEqual([])
  })

  test('ignores writes from mutually exclusive branches', () => {
    const messages = lint(`
      declare const flag: boolean
      declare function consumeCount(value: number): void
      let value
      if (flag) {
        value = { name: 'Nook' }
      } else {
        value = 1
        consumeCount(value)
      }
    `)

    expect(messages).toEqual([])
  })

  test('ignores writes from switch cases that terminate before the call case', () => {
    const messages = lint(`
      declare const flag: number
      declare function consumeCount(value: number): void
      let value = 1
      switch (flag) {
        case 1:
          value = { name: 'Nook' }
          break
        case 2:
          consumeCount(value)
          break
      }
    `)

    expect(messages).toEqual([])
  })

  test('ignores writes on paths that exit before the call', () => {
    const messages = lint(`
      declare const flag: boolean
      declare function consumeCount(value: number): void
      function run(): void {
        let value
        if (flag) {
          value = { name: 'Nook' }
          return
        }
        value = 1
        consumeCount(value)
      }
    `)
    expect(messages).toEqual([])
  })

  test('rejects untyped object-valued parameter defaults', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      function forward(args = { name: 'Nook' }): void {
        consume(args)
      }
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('accepts annotations on enclosing parameter patterns', () => {
    const messages = lint(`
      type ConsumeArgs = { name: string }
      type Params = { args?: ConsumeArgs }
      declare function consume(value: ConsumeArgs): void
      function forward({ args = { name: 'Nook' } }: Params): void {
        consume(args)
      }
    `)

    expect(messages).toEqual([])
  })

  test('resolves constant computed destructuring keys', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      const key = 'picked'
      const { [key]: args } = { picked: { name: 'Nook' } }
      consume(args)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('preserves repeated named array spreads during projection', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      const values = [0]
      consume(([...values, ...values, { name: 'Nook' }])[2])
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('preserves conditional array layouts during projection', () => {
    const messages = lint(`
      declare const flag: boolean
      declare function consume(value: number | { name: string }): void
      consume(([...(flag ? [0] : []), { name: 'Nook' }])[0])
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('preserves the empty layout of unresolved array spreads', () => {
    const messages = lint(`
      declare function consume(value: number | { name: string }): void
      function forward(values: number[]): void {
        consume(([...values, { name: 'Nook' }])[0])
      }
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('analyzes many conditional spreads without enumerating layouts', () => {
    const spreads = Array.from(
      { length: 30 },
      () => '...(flag ? [0] : [])',
    ).join(', ')
    const messages = lint(`
      declare const flag: boolean
      declare function consume(value: number | { name: string }): void
      consume(([${spreads}, { name: 'Nook' }])[0])
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('inspects named values in conditional result branches', () => {
    const messages = lint(`
      type ConsumeArgs = { name: string }
      declare const flag: boolean
      declare function consume(value: ConsumeArgs): void
      const typedArgs: ConsumeArgs = { name: 'Vault' }
      const args = { name: 'Nook' }
      consume(flag ? typedArgs : args)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('accepts explicitly typed parameter arguments', () => {
    const messages = lint(`
      type ConsumeArgs = { name: string }
      declare function consume(value: ConsumeArgs): void
      function forward(args: ConsumeArgs): void {
        args = { name: 'Nook' }
        consume(args)
      }
    `)

    expect(messages).toEqual([])
  })

  test('uses only the result operand of a sequence expression', () => {
    const messages = lint(`
      type ConsumeArgs = { name: string }
      declare function consume(value: ConsumeArgs): void
      let scratch: ConsumeArgs
      const typedArgs: ConsumeArgs = { name: 'Vault' }
      consume((scratch = { name: 'Nook' }, typedArgs))
    `)

    expect(messages).toEqual([])
  })

  test('follows assignment initializers for named arguments', () => {
    const messages = lint(`
      type ConsumeArgs = { name: string }
      declare function consume(value: ConsumeArgs): void
      let target: ConsumeArgs
      const args = (target = { name: 'Nook' })
      consume(args)
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('rejects awaited object literals at call sites', () => {
    const messages = lint(`
      type ConsumeArgs = { name: string }
      declare function consume(value: ConsumeArgs): void
      async function run(): Promise<void> {
        consume(await { name: 'Nook' })
      }
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('rejects awaited untyped named object arguments', () => {
    const messages = lint(`
      type ConsumeArgs = { name: string }
      declare function consume(value: ConsumeArgs): void
      async function run(): Promise<void> {
        const args = { name: 'Nook' }
        consume(await args)
      }
    `)

    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('resolves constant computed member keys', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      const key = 'picked'
      consume(({ picked: { name: 'Nook' } })[key])
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('resolves no-substitution template literal member keys', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      consume(({ args: { name: 'Nook' } })[\`args\`])
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('inspects statically resolvable getter results', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      consume(({ get picked() { return { name: 'Nook' } } }).picked)
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('includes destructuring defaults in binding values', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      declare const source: { picked?: { name: string } }
      const { picked: args = { name: 'Nook' } } = source
      consume(args)
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('inspects named assignment results at call sites', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      const args = { name: 'Nook' }
      let target
      consume(target = args)
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('tracks object-valued for-of and callback parameters', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      for (const args of [{ name: 'Nook' }]) consume(args)
      ;[{ name: 'Vault' }].forEach((args) => consume(args))
      ;[{ name: 'Sentinel' }].map((args) => consume(args))
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
      'typedArgument',
      'typedArgument',
    ])
  })

  test('tracks reducer element parameters', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      ;[{ name: 'Nook' }].reduce((count, args) => {
        consume(args)
        return count
      }, 0)
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'typedArgument',
    ])
  })

  test('tracks writes to projected member arguments', () => {
    const messages = lint(`
      type Holder = { value: number | { name: string } }
      declare function consume(value: Holder['value']): void
      const holder: Holder = { value: 1 }
      holder.value = { name: 'Nook' }
      consume(holder.value)
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('tracks writes to nested projected member arguments', () => {
    const messages = lint(`
      type Holder = { inner: { value: number | { name: string } } }
      declare function consume(value: Holder['inner']['value']): void
      const holder: Holder = { inner: { value: 1 } }
      holder.inner.value = { name: 'Nook' }
      consume(holder.inner.value)
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })

  test('inspects statically resolvable IIFE results', () => {
    const messages = lint(`
      declare function consume(value: { name: string }): void
      consume((() => ({ name: 'Nook' }))())
      consume((() => { return { name: 'Vault' } })())
      type Factory = () => { name: string }
      consume(((() => ({ name: 'Sentinel' })) as Factory)())
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
      'namedArgument',
      'namedArgument',
    ])
  })

  test('preserves missing-key object spread alternatives', () => {
    const messages = lint(`
      declare const flag: boolean
      declare function consume(value: number | { name: string }): void
      const spread = flag ? { args: 1 } : {}
      consume(({ args: { name: 'Nook' }, ...spread }).args)
    `)
    expect(messages.map((message) => message.messageId)).toEqual([
      'namedArgument',
    ])
  })
})
