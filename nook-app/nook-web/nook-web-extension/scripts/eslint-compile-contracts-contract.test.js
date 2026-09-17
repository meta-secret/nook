import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import compileContractsEslintConfig from '../../eslint.compile-contracts.config.js'

const extensionSourceDirectory = fileURLToPath(
  new URL('../src/', import.meta.url),
)
const adapterFilePath = fileURLToPath(
  new URL('../src/lib/nook-wasm.ts', import.meta.url),
)

class CompileContractsConfigTestHarness {
  /** @param {import('eslint').Linter.LintMessage[]} messages */
  static ruleIds(messages) {
    return messages.map((message) => message.ruleId)
  }

  /** @param {string} source @param {'.ts' | '.svelte'} extension */
  static lintTemporarySource(source, extension) {
    const fixtureDirectory = mkdtempSync(
      join(extensionSourceDirectory, '__compile-contracts-'),
    )
    const filePath = join(fixtureDirectory, `contract${extension}`)
    try {
      writeFileSync(filePath, source)
      return new Linter().verify(source, compileContractsEslintConfig, filePath)
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  }

  /** @param {string} source */
  static lintAdapterSource(source) {
    const adapterConfig = [
      ...compileContractsEslintConfig,
      { rules: { 'nook-typed-api/no-empty-success-contract': 'off' } },
    ]
    return new Linter().verify(source, adapterConfig, adapterFilePath)
  }
}

describe('focused compile-contract ESLint config', () => {
  test('enables the custom success-contract and concrete-value rules for TypeScript', () => {
    const messages = CompileContractsConfigTestHarness.lintTemporarySource(
      `
        import { ok, type Result } from 'neverthrow'
        type SaveFailure = { readonly kind: 'storage' }
        export function save(): Result<void, SaveFailure> { return ok() }
        declare function receive(message: unknown): void
        function collectPair(first: string, second: string): void {
          void first
          void second
        }
      `,
      '.ts',
    )

    expect(CompileContractsConfigTestHarness.ruleIds(messages)).toContain(
      'nook-typed-api/no-empty-success-contract',
    )
    expect(CompileContractsConfigTestHarness.ruleIds(messages)).toContain(
      '@typescript-eslint/no-restricted-types',
    )
    expect(CompileContractsConfigTestHarness.ruleIds(messages)).not.toContain(
      'max-params',
    )
  })

  test('enables the custom success-contract and concrete-value rules for Svelte', () => {
    const messages = CompileContractsConfigTestHarness.lintTemporarySource(
      `
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
      `,
      '.svelte',
    )

    expect(CompileContractsConfigTestHarness.ruleIds(messages)).toContain(
      'nook-typed-api/no-empty-success-contract',
    )
    expect(CompileContractsConfigTestHarness.ruleIds(messages)).toContain(
      '@typescript-eslint/no-restricted-types',
    )
    expect(CompileContractsConfigTestHarness.ruleIds(messages)).not.toContain(
      'max-params',
    )
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

    expect(CompileContractsConfigTestHarness.ruleIds(messages)).toContain(
      'no-restricted-syntax',
    )
    expect(CompileContractsConfigTestHarness.ruleIds(messages)).not.toContain(
      '@typescript-eslint/no-restricted-types',
    )
  })
})
