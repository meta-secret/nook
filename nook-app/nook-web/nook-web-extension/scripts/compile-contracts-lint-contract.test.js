import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import compileContractsOxlintConfig from '../../oxlint.compile-contracts.config.ts'
import {
  oxlintRules,
  typedApiSourceFiles,
  untrustedInputAdapterFiles,
  untrustedInputAdapterRules,
} from '../../typed-api-rules.js'
import { CompileContractFixture } from './compile-contract-fixture.js'
import {
  OxlintHarness,
  SuccessContractHarness,
  SvelteEslintHarness,
} from './lint-contract-harness.js'

// TypeScript cases run oxlint and the TypeScript 7 check on Node; Svelte
// cases build a TypeScript 6 program through typescript-eslint. Release
// verification runs every static, lint, and unit gate in parallel in one
// container, where that can take well over fifteen seconds.
setDefaultTimeout(60_000)
const oxlint = new OxlintHarness({})
const svelteEslint = new SvelteEslintHarness(
  'eslint.compile-contracts.config.js',
)
afterAll(() => {
  CompileContractFixture.remove()
  oxlint.remove()
})

const extensionPackagePath = fileURLToPath(
  new URL('../package.json', import.meta.url),
)
const i18nGeneratorPath = fileURLToPath(
  new URL('../../nook-web-app/scripts/generate-i18n-keys.mjs', import.meta.url),
)
const namedSuccessContractTestPath = fileURLToPath(
  new URL('./named-success-contract.test.js', import.meta.url),
)
const adapterFile = 'nook-web-extension/src/lib/nook-wasm.ts'

class CompileContractsConfigTestHarness {
  /** @param {{ ruleId: string | null }[]} messages */
  static ruleIds(messages) {
    return messages.map((message) => message.ruleId)
  }

  /** Oxlint and the TypeScript 7 check, as the compile image runs them. @param {string} source */
  static lintTypeScript(source) {
    const filePath = CompileContractFixture.path('.ts')
    writeFileSync(filePath, source)
    return [
      ...oxlint.lintWithConfig({
        config: 'oxlint.compile-contracts.config.ts',
        file: filePath,
      }),
      ...SuccessContractHarness.check(filePath),
    ]
  }

  /** @param {string} source */
  static lintSvelte(source) {
    const filePath = CompileContractFixture.path('.svelte')
    writeFileSync(filePath, source)
    return svelteEslint.lint({ source, filePath })
  }

  /**
   * The rules the compile config applies to an allowlisted adapter: the
   * typed-API override, then the adapter override, in config order.
   * @param {string} source
   */
  static lintAdapterSource(source) {
    const { overrides = [] } = compileContractsOxlintConfig
    const typedApi = overrides.find(
      (override) => override.files === typedApiSourceFiles,
    )
    const adapter = overrides.find(
      (override) => override.files === untrustedInputAdapterFiles,
    )
    if (!typedApi || !adapter) {
      throw new Error('compile config must keep both typed-API overrides')
    }
    expect(overrides.indexOf(adapter)).toBeGreaterThan(
      overrides.indexOf(typedApi),
    )
    expect(adapter.rules).toEqual(oxlintRules(untrustedInputAdapterRules))
    return oxlint.lintRules({
      source,
      extension: '.ts',
      rules: { ...typedApi.rules, ...adapter.rules },
    })
  }
}

describe('focused compile-contract lint configs', () => {
  test('extension lint ignores transient compile-contract fixtures', () => {
    const packageSource = readFileSync(extensionPackagePath, 'utf8')
    expect(packageSource).toContain(
      "--ignore-pattern '**/__compile-contracts-*/**'",
    )
    const i18nGeneratorSource = readFileSync(i18nGeneratorPath, 'utf8')
    expect(i18nGeneratorSource).toContain(
      "entry.name.startsWith('__compile-contracts-')",
    )
    const namedSuccessContractTestSource = readFileSync(
      namedSuccessContractTestPath,
      'utf8',
    )
    expect(namedSuccessContractTestSource).toContain(
      "CompileContractFixture.path('.ts')",
    )
    expect(namedSuccessContractTestSource).toMatch(
      /const typeAwareSvelteMessages =\s+await SvelteNamedSuccessContractTestHarness\.lint\(`/,
    )
    expect(namedSuccessContractTestSource).not.toMatch(
      /test\('uses type-aware parser services for Svelte scripts',[\s\S]*?SvelteNamedSuccessContractTestHarness\.lint\(`/,
    )
  })

  test('the compile image adapter is allowlisted', () => {
    expect(untrustedInputAdapterFiles).toContain(adapterFile)
  })

  test('rejects TypeScript type predicates in authored TypeScript', () => {
    const messages = CompileContractsConfigTestHarness.lintTypeScript(`
      export function isMessage(value: string): value is string {
        return value.length > 0
      }
    `)

    expect(CompileContractsConfigTestHarness.ruleIds(messages)).toContain(
      'nook-syntax/no-restricted-syntax',
    )
  })

  test('rejects TypeScript type predicates in authored Svelte scripts', async () => {
    const messages = await CompileContractsConfigTestHarness.lintSvelte(`
      <script lang="ts">
        export function isMessage(value: string): value is string {
          return value.length > 0
        }
      </script>
    `)

    expect(CompileContractsConfigTestHarness.ruleIds(messages)).toContain(
      'no-restricted-syntax',
    )
  })

  test('accepts a concrete API without a type predicate', () => {
    const messages = CompileContractsConfigTestHarness.lintTypeScript(`
      type MessageDecode =
        | { readonly kind: 'decoded'; readonly message: string }
        | { readonly kind: 'rejected' }
      export function decodeMessage(value: string): MessageDecode {
        return { kind: 'decoded', message: value }
      }
    `)

    expect(messages).toEqual([])
  })

  test('enables the custom success-contract and concrete-value rules for TypeScript', () => {
    const messages = CompileContractsConfigTestHarness.lintTypeScript(`
      import { ok, type Result } from 'neverthrow'
      type SaveFailure = { readonly kind: 'storage' }
      export function save(): Result<void, SaveFailure> { return ok() }
      declare function receive(message: unknown): void
      function collectPair(first: string, second: string): void {
        void first
        void second
      }
    `)

    const ruleIds = CompileContractsConfigTestHarness.ruleIds(messages)
    expect(ruleIds).toContain('nook-typed-api/no-empty-success-contract')
    expect(ruleIds).toContain('typescript/no-restricted-types')
    expect(ruleIds).not.toContain('eslint/max-params')
  })

  test('enables the custom success-contract and concrete-value rules for Svelte', async () => {
    const messages = await CompileContractsConfigTestHarness.lintSvelte(`
      <script lang="ts">
        import { ok, type Result } from 'neverthrow'
        type SaveFailure = { readonly kind: 'storage' }
        export function save(): Result<void, SaveFailure> { return ok() }
        declare function receive(message: unknown): void
        function collectPair(first: string, second: string): void {
          void first
          void second
        }
      </script>
    `)

    const ruleIds = CompileContractsConfigTestHarness.ruleIds(messages)
    expect(ruleIds).toContain('nook-typed-api/no-empty-success-contract')
    expect(ruleIds).toContain('@typescript-eslint/no-restricted-types')
    expect(ruleIds).not.toContain('max-params')
  })

  test('allows a singular unknown in an allowlisted adapter', () => {
    const messages = CompileContractsConfigTestHarness.lintAdapterSource(
      'declare function decode(message: unknown): void',
    )

    expect(messages).toEqual([])
  })

  test('rejects nested unknown in an allowlisted adapter', () => {
    const messages = CompileContractsConfigTestHarness.lintAdapterSource(
      'type AdapterPayloads = Array<unknown>',
    )

    const ruleIds = CompileContractsConfigTestHarness.ruleIds(messages)
    expect(ruleIds).toContain('nook-syntax/no-restricted-syntax')
    expect(ruleIds).not.toContain('typescript/no-restricted-types')
  })
})
