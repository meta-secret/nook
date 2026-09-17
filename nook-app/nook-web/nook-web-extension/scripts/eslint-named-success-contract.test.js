import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import typescript from 'typescript'
import typescriptEslint from 'typescript-eslint'
import namedSuccessEslintConfig from '../../eslint.named-success.config.js'
import { namedSuccessContractBaseline } from '../../named-success-contract-baseline.js'
import { noEmptySuccessContractRule } from '../../no-empty-success-contract-rule.js'

/** @typedef {import('eslint').Linter.LintMessage} LintMessage */

class NamedSuccessContractTestHarness {
  /** @param {string} source */
  static lint(source) {
    const root = mkdtempSync(join(tmpdir(), 'nook-success-contract-'))
    try {
      const filePath = join(root, 'contract.ts')
      const neverthrowTypes = join(root, 'node_modules', 'neverthrow')
      mkdirSync(neverthrowTypes, { recursive: true })
      writeFileSync(filePath, source)
      writeFileSync(
        join(neverthrowTypes, 'index.d.ts'),
        `
          export class Ok<T, E> { readonly value: T }
          export class Err<T, E> { readonly error: E }
          export type Result<T, E> = Ok<T, E> | Err<T, E>
          export function ok<T, E = never>(value: T): Ok<T, E>
          export function ok<E = never>(): Ok<void, E>
        `,
      )
      const compilerOptions = {
        strict: true,
        target: typescript.ScriptTarget.ES2022,
        module: typescript.ModuleKind.CommonJS,
        moduleResolution: typescript.ModuleResolutionKind.Node10,
        skipLibCheck: true,
        types: [],
      }
      const program = typescript.createProgram([filePath], compilerOptions)
      const config = {
        languageOptions: {
          parser: typescriptEslint.parser,
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            programs: [program],
          },
        },
        plugins: {
          'nook-typed-api': {
            rules: {
              'no-empty-success-contract': noEmptySuccessContractRule,
            },
          },
        },
        rules: {
          'nook-typed-api/no-empty-success-contract': 'error',
        },
      }
      const messages = new Linter().verify(
        source,
        /** @type {import('eslint').Linter.Config & typeof config} */ (config),
        filePath,
      )
      return messages.filter(
        (message) =>
          message.ruleId === 'nook-typed-api/no-empty-success-contract',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

class SvelteNamedSuccessContractTestHarness {
  /** @param {string} source */
  static lint(source) {
    return this.lintAll(source).filter(
      (message) =>
        message.ruleId === 'nook-typed-api/no-empty-success-contract',
    )
  }

  /** @param {string} source */
  static lintAll(source) {
    const sourceDirectory = fileURLToPath(new URL('../src/', import.meta.url))
    const fixtureDirectory = mkdtempSync(
      join(sourceDirectory, '__named-success-contract-'),
    )
    const filePath = join(fixtureDirectory, 'contract.svelte')
    try {
      writeFileSync(filePath, source)
      const messages = new Linter().verify(
        source,
        /** @type {import('eslint').Linter.Config[]} */ (
          namedSuccessEslintConfig
        ),
        filePath,
      )
      return messages
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  }
}

/** @param {LintMessage[]} messages @param {string} messageId */
function expectMessage(messages, messageId) {
  expect(messages.map((message) => message.messageId)).toContain(messageId)
}

/** @param {string} source */
function gitBlobSha1(source) {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(source, 'utf8')}\0`, 'utf8')
    .update(source, 'utf8')
    .digest('hex')
}

describe('nook-typed-api/no-empty-success-contract', () => {
  test('rejects a zero-argument neverthrow ok call', () => {
    const messages = NamedSuccessContractTestHarness.lint(`
      import { ok } from 'neverthrow'
      export function save(): ReturnType<typeof ok> {
        return ok()
      }
    `)

    expectMessage(messages, 'emptySuccessCall')
  })

  test('resolves aliases of neverthrow ok and Result by TypeScript symbol', () => {
    const messages = NamedSuccessContractTestHarness.lint(`
      import { ok as succeed, type Result as OperationResult } from 'neverthrow'
      type StorageFailure = { readonly kind: 'storage' }
      type SaveOutcome = OperationResult<void, StorageFailure>
      export function save(): Promise<SaveOutcome> {
        return Promise.resolve(succeed())
      }
    `)

    expectMessage(messages, 'emptySuccessCall')
    expectMessage(messages, 'emptySuccessType')
  })

  test('rejects nested Promise<Result<void, E>> and Ok<void, E> contracts', () => {
    const messages = NamedSuccessContractTestHarness.lint(`
      import type { Ok as NeverthrowOk, Result } from 'neverthrow'
      type StorageFailure = { readonly kind: 'storage' }
      export type EmptyOperation = Promise<Result<void, StorageFailure>>
      export type EmptySuccess = NeverthrowOk<void, StorageFailure>
    `)

    expectMessage(messages, 'emptySuccessType')
  })

  test('checks function, arrow, and method return contracts', () => {
    const messages = NamedSuccessContractTestHarness.lint(`
      import type { Result } from 'neverthrow'
      type StorageFailure = { readonly kind: 'storage' }
      export function save(): Result<void, StorageFailure> {
        throw new Error('fixture')
      }
      export const remove = (): Promise<Result<void, StorageFailure>> => {
        throw new Error('fixture')
      }
      export class VaultWriter {
        async persist(): Promise<Result<void, StorageFailure>> {
          throw new Error('fixture')
        }
      }
    `)

    expect(
      messages.filter((message) => message.messageId === 'emptySuccessType'),
    ).not.toHaveLength(0)
  })

  test('accepts named concrete success values and the vault approval completion shape', () => {
    const messages = NamedSuccessContractTestHarness.lint(`
      import { ok, type Result } from 'neverthrow'
      type VaultStorageFailure = { readonly kind: 'storage' }
      type NookVaultManager = { readonly generation: number }
      export type ExtensionVaultCompletion = {
        readonly manager: NookVaultManager
      }
      export class ExtensionVaultApproval {
        admitCompletion(): Result<ExtensionVaultCompletion, VaultStorageFailure> {
          return ok({ manager: { generation: 1 } })
        }
      }
      export function createVault(): Result<NookVaultManager, VaultStorageFailure> {
        return ok({ generation: 1 })
      }
    `)

    expect(messages).toEqual([])
  })

  test('accepts effect-only Promise<void> and unrelated methods named ok', () => {
    const messages = NamedSuccessContractTestHarness.lint(`
      type Effect = () => Promise<void>
      export const flush: Effect = async () => {}
      export class HttpResponse {
        ok(): boolean { return true }
      }
      export function checkResponse(response: HttpResponse): boolean {
        return response.ok()
      }
    `)

    expect(messages).toEqual([])
  })

  test('does not treat local Result or ok lookalikes as neverthrow', () => {
    const messages = NamedSuccessContractTestHarness.lint(`
      type Result<T, E> = { readonly value: T; readonly failure: E }
      type Ok<T, E> = { readonly result: T; readonly fault: E }
      function ok(): boolean { return true }
      export function receive(): boolean {
        const result: Result<void, string> = { value: void 0, failure: 'none' }
        const success: Ok<void, string> = { result: void 0, fault: 'none' }
        return ok() && result.failure.length > 0 && success.fault.length > 0
      }
    `)

    expect(messages).toEqual([])
  })

  test('does not inspect empty success types hidden only in the error payload', () => {
    const messages = NamedSuccessContractTestHarness.lint(`
      import type { Ok, Result } from 'neverthrow'
      type StorageFailure = { readonly cause: Ok<void, string> }
      type PersistedRecord = { readonly id: string }
      export function persist(): Result<PersistedRecord, StorageFailure> {
        throw new Error('fixture')
      }
    `)

    expect(messages).toEqual([])
  })

  test('uses type-aware parser services for Svelte scripts', () => {
    const messages = SvelteNamedSuccessContractTestHarness.lint(`
      <script lang="ts">
        import { ok as succeed, type Result } from 'neverthrow'
        type StorageFailure = { readonly kind: 'storage' }
        export function save(): Promise<Result<void, StorageFailure>> {
          return Promise.resolve(succeed())
        }
      </script>
    `)

    expectMessage(messages, 'emptySuccessCall')
    expectMessage(messages, 'emptySuccessType')
  })

  test('dedicated config enables only the named-success gate', () => {
    const messages = SvelteNamedSuccessContractTestHarness.lintAll(`
      <script lang="ts">
        import { ok } from 'neverthrow'
        function tooManyParameters(first: string, second: string): void {
          void first
          void second
        }
        tooManyParameters('first', 'second')
        ok()
      </script>
    `)

    expect(messages.map((message) => message.ruleId)).toEqual([
      'nook-typed-api/no-empty-success-contract',
    ])
  })

  test('legacy baseline contains only exact current source snapshots', () => {
    const webRoot = fileURLToPath(new URL('../../', import.meta.url))
    const staleEntries = namedSuccessContractBaseline.filter((entry) => {
      const source = readFileSync(join(webRoot, entry.file), 'utf8')
      return gitBlobSha1(source) !== entry.gitBlobSha1
    })

    expect(staleEntries).toEqual([])
  })
})
