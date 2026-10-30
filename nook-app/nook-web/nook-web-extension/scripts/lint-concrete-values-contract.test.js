import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import {
  oxlintRules,
  typedApiRules,
  untrustedInputAdapterFiles,
  untrustedInputAdapterRules,
} from '../../typed-api-rules.js'
import { OxlintHarness, SvelteEslintHarness } from './lint-contract-harness.js'

// Oxlint runs these rules for TypeScript; each case is one oxlint run on Node.
setDefaultTimeout(60_000)

const oxlint = new OxlintHarness({})
afterAll(() => oxlint.remove())
const svelteEslint = new SvelteEslintHarness('eslint.config.js')
const svelteFixturePath = new URL(
  '../src/popup/ConnectChain.svelte',
  import.meta.url,
).pathname

const restrictedTypes = 'typescript/no-restricted-types'
const restrictedSyntax = 'nook-syntax/no-restricted-syntax'

/** @typedef {typeof typedApiRules | typeof untrustedInputAdapterRules} ConcreteRuleSet */

/** @param {ConcreteRuleSet} rules */
function concreteValueRule(rules) {
  return {
    '@typescript-eslint/no-restricted-types':
      rules['@typescript-eslint/no-restricted-types'],
    'no-restricted-syntax': rules['no-restricted-syntax'],
  }
}

/** @typedef {{ source: string, rules: ConcreteRuleSet }} LintRequest */

/** @param {LintRequest} args */
function lint(args) {
  return oxlint.lintRules({
    source: args.source,
    extension: '.ts',
    rules: oxlintRules(concreteValueRule(args.rules)),
  })
}

/** @param {LintRequest} args */
function ruleIds(args) {
  return lint(args).map((message) => message.ruleId)
}

describe('typed API concrete values', () => {
  test('rejects unknown in domain code', () => {
    expect(
      ruleIds({
        source: 'declare function receive(message: unknown): void',
        rules: typedApiRules,
      }),
    ).toContain(restrictedTypes)
  })

  test('rejects unknown in array and nested generic types', () => {
    const sources = [
      'declare function receive(messages: unknown[]): void',
      'declare function receive(messages: Array<unknown>): void',
      'declare function receive(message: Promise<ReadonlyArray<{ payload: unknown }>>): void',
    ]

    for (const source of sources) {
      expect(ruleIds({ source, rules: typedApiRules })).toContain(
        restrictedTypes,
      )
    }
  })

  test('rejects generic object annotations in domain code', () => {
    expect(
      ruleIds({
        source: 'declare function receive(message: object): void',
        rules: typedApiRules,
      }),
    ).toContain(restrictedTypes)
  })

  test('rejects generic object annotations in untrusted input adapters', () => {
    expect(
      ruleIds({
        source: 'declare function decode(message: object): void',
        rules: untrustedInputAdapterRules,
      }),
    ).toEqual([restrictedTypes])
  })

  test('allows unknown only in an untrusted input adapter', () => {
    expect(
      lint({
        source: 'declare function decode(message: unknown): void',
        rules: untrustedInputAdapterRules,
      }),
    ).toEqual([])
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

    const source = 'declare function decode(message: unknown): void'
    expect(lint({ source, rules: untrustedInputAdapterRules })).toEqual([])
    expect(ruleIds({ source, rules: typedApiRules })).toContain(restrictedTypes)
  })

  test('rejects Chrome runtime unknown array even in an allowlisted adapter', () => {
    // `connect.ts` currently models the callback as `unknown[]`; this fixture
    // keeps that allowlist debt visible while the adapter moves to a concrete
    // callback type.
    expect(untrustedInputAdapterFiles).toContain(
      'nook-web-shared/src/vault-app/lib/extension/connect.ts',
    )

    expect(
      ruleIds({
        source: 'type ChromeRuntimeResponseArguments = unknown[]',
        rules: untrustedInputAdapterRules,
      }),
    ).toContain(restrictedSyntax)
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
      expect(ruleIds({ source, rules: untrustedInputAdapterRules })).toContain(
        restrictedSyntax,
      )
    }
  })

  test('rejects nested unknown types in Svelte TypeScript', async () => {
    // ESLint keeps these rules for Svelte; lint as a typed-API component.
    const messages = await svelteEslint.lint({
      source: `
        <script lang="ts">
          type ComponentState = Promise<ReadonlyArray<{ payload: unknown }>>
        </script>
      `,
      filePath: svelteFixturePath,
    })

    expect(messages.map((message) => message.ruleId)).toContain(
      '@typescript-eslint/no-restricted-types',
    )
  })

  test('accepts a concrete message union', () => {
    expect(
      lint({
        source: `
          enum RuntimeMessageKind { Query = 'query', Commit = 'commit' }
          type RuntimeMessage =
            | { type: RuntimeMessageKind.Query; query: string }
            | { type: RuntimeMessageKind.Commit; secretId: string }
          declare function receive(message: RuntimeMessage): void
        `,
        rules: typedApiRules,
      }),
    ).toEqual([])
  })

  test('accepts concrete values in nested generic types', () => {
    expect(
      lint({
        source: `
          type RuntimeMessage = { readonly kind: 'query'; readonly query: string }
          declare function receive(messages: Promise<ReadonlyArray<RuntimeMessage>>): void
        `,
        rules: typedApiRules,
      }),
    ).toEqual([])
  })
})
