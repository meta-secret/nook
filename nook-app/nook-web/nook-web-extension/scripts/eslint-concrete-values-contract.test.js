import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import svelteParser from 'svelte-eslint-parser'
import ts from 'typescript-eslint'
import {
  typedApiRules,
  untrustedInputAdapterFiles,
  untrustedInputAdapterRules,
} from '../../typed-api-rules.js'

/** @typedef {typeof typedApiRules | typeof untrustedInputAdapterRules} ConcreteRuleSet */
/** @typedef {{ source: string, rules: ReturnType<typeof concreteValueRule> }} LintRequest */

/** @param {LintRequest} args */
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
  return new Linter().verify(
    args.source,
    /** @type {import('eslint').Linter.Config & typeof config} */ (config),
  )
}

/** @param {ConcreteRuleSet} rules */
function concreteValueRule(rules) {
  const [, options] = rules['@typescript-eslint/no-restricted-types']
  if (!options) throw new Error('concrete value rule requires options')
  /** @type {['error', typeof options]} */
  const configuredRule = ['error', options]
  const restrictedSyntax = rules['no-restricted-syntax']
  return {
    '@typescript-eslint/no-restricted-types': configuredRule,
    ...(restrictedSyntax ? { 'no-restricted-syntax': restrictedSyntax } : {}),
  }
}

describe('typed API concrete values', () => {
  test('rejects unknown in domain code', () => {
    const args = {
      source: 'declare function receive(message: unknown): void',
      rules: concreteValueRule(typedApiRules),
    }
    const messages = lint(args)

    expect(messages.map((message) => message.ruleId)).toContain(
      '@typescript-eslint/no-restricted-types',
    )
  })

  test('rejects unknown in array and nested generic types', () => {
    const sources = [
      'declare function receive(messages: unknown[]): void',
      'declare function receive(messages: Array<unknown>): void',
      'declare function receive(message: Promise<ReadonlyArray<{ payload: unknown }>>): void',
    ]

    for (const source of sources) {
      const args = { source, rules: concreteValueRule(typedApiRules) }
      const messages = lint(args)

      expect(messages.map((message) => message.ruleId)).toContain(
        '@typescript-eslint/no-restricted-types',
      )
    }
  })

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

  test('keeps unknown exceptions on explicitly allowlisted adapter fixtures', () => {
    expect(untrustedInputAdapterFiles).toContain(
      'nook-web-extension/src/lib/login-picker-messages.ts',
    )
    expect(untrustedInputAdapterFiles).toContain(
      'nook-web-extension/src/lib/nook-wasm.ts',
    )
    expect(untrustedInputAdapterFiles).not.toContain(
      'nook-web-extension/src/lib/login-picker-controller.ts',
    )

    const adapterArgs = {
      source: 'declare function decode(message: unknown): void',
      rules: concreteValueRule(untrustedInputAdapterRules),
    }
    const domainArgs = {
      source: 'declare function decode(message: unknown): void',
      rules: concreteValueRule(typedApiRules),
    }

    expect(lint(adapterArgs)).toEqual([])
    expect(lint(domainArgs).map((message) => message.ruleId)).toContain(
      '@typescript-eslint/no-restricted-types',
    )
  })

  test('rejects Chrome runtime unknown array even in an allowlisted adapter', () => {
    // `connect.ts` currently models the callback as `unknown[]`; this fixture
    // keeps that allowlist debt visible while the adapter moves to a concrete
    // callback type.
    expect(untrustedInputAdapterFiles).toContain(
      'nook-web-shared/src/vault-app/lib/extension/connect.ts',
    )

    const args = {
      source: 'type ChromeRuntimeResponseArguments = unknown[]',
      rules: concreteValueRule(untrustedInputAdapterRules),
    }
    const messages = lint(args)

    expect(messages.map((message) => message.ruleId)).toContain(
      'no-restricted-syntax',
    )
  })

  test('rejects nested unknown values in allowlisted adapters', () => {
    const sources = [
      'type UnknownMessages = Array<unknown>',
      'type NestedMessage = Promise<ReadonlyArray<{ payload: unknown }>>',
      'type UnknownRecord = Record<string, unknown>',
      'type UnknownTuple = readonly [unknown]',
      'type UnknownUnion = unknown | string',
    ]

    for (const source of sources) {
      const args = {
        source,
        rules: concreteValueRule(untrustedInputAdapterRules),
      }
      const messages = lint(args)

      expect(messages.map((message) => message.ruleId)).toContain(
        'no-restricted-syntax',
      )
    }
  })

  test('rejects nested unknown types in Svelte TypeScript', () => {
    const config = {
      languageOptions: {
        parser: svelteParser,
        parserOptions: {
          ecmaVersion: 2022,
          parser: ts.parser,
          sourceType: 'module',
        },
      },
      plugins: {
        '@typescript-eslint': ts.plugin,
      },
      rules: concreteValueRule(typedApiRules),
    }
    const source = `
      <script lang="ts">
        type ComponentState = Promise<ReadonlyArray<{ payload: unknown }>>
      </script>
    `
    const messages = new Linter().verify(
      source,
      /** @type {import('eslint').Linter.Config & typeof config} */ (config),
    )

    expect(messages.map((message) => message.ruleId)).toContain(
      '@typescript-eslint/no-restricted-types',
    )
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

  test('accepts concrete values in nested generic types', () => {
    const args = {
      source: `
        type RuntimeMessage = { readonly kind: 'query'; readonly query: string }
        declare function receive(messages: Promise<ReadonlyArray<RuntimeMessage>>): void
      `,
      rules: concreteValueRule(typedApiRules),
    }

    expect(lint(args)).toEqual([])
  })
})
