import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { namedSuccessContractBaseline } from '../../named-success-contract-baseline.js'
import { CompileContractFixture } from './compile-contract-fixture.js'
import {
  SuccessContractHarness,
  SvelteEslintHarness,
} from './lint-contract-harness.js'

// TypeScript cases run the TypeScript 7 check on Node; Svelte cases build a
// TypeScript 6 program through typescript-eslint. Release verification runs
// every static, lint, and unit gate in parallel in one container, where that
// can take well over fifteen seconds.
setDefaultTimeout(60_000)
afterAll(() => CompileContractFixture.remove())

const webRoot = fileURLToPath(new URL('../../', import.meta.url))
const svelteFixturePath = fileURLToPath(
  new URL('../src/popup/PopupApp.svelte', import.meta.url),
)
const ruleId = 'nook-typed-api/no-empty-success-contract'
const svelteEslint = new SvelteEslintHarness('eslint.named-success.config.js')

/** @typedef {{ messageId?: string | undefined }} ReportedMessage */

class NamedSuccessContractTestHarness {
  /** @param {string} source */
  static lint(source) {
    const filePath = CompileContractFixture.path('.ts')
    writeFileSync(filePath, source)
    return SuccessContractHarness.check(filePath)
  }
}

class SvelteNamedSuccessContractTestHarness {
  /** @param {string} source */
  static async lint(source) {
    const messages = await this.lintAll(source)
    return messages.filter((message) => message.ruleId === ruleId)
  }

  /** @param {string} source */
  static lintAll(source) {
    return svelteEslint.lint({ source, filePath: svelteFixturePath })
  }
}

/** @param {ReportedMessage[]} messages @param {string} messageId */
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

// Type-aware Svelte parser bootstrap can exceed Bun's per-test timeout on a
// cold, contended runner. Keep that initialization in module setup so the test
// measures the contract assertions, while the overall suite still fails if
// parser setup or linting fails.
const typeAwareSvelteMessages =
  await SvelteNamedSuccessContractTestHarness.lint(`
  <script lang="ts">
    import { ok as succeed, type Result } from 'neverthrow'
    type StorageFailure = { readonly kind: 'storage' }
    export function save(): Promise<Result<void, StorageFailure>> {
      return Promise.resolve(succeed())
    }
  </script>
`)

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

    expect(messages.map((message) => message.line)).toEqual([4, 5])
    expectMessage(messages, 'emptySuccessType')
  })

  test('reports only the outermost empty contract and skips inline property payloads', () => {
    const messages = NamedSuccessContractTestHarness.lint(`
      import type { Result } from 'neverthrow'
      type StorageFailure = { readonly kind: 'storage' }
      export type Outer = Promise<Promise<Result<void, StorageFailure>>>
      export type Payload = { readonly inner: Result<void, StorageFailure> }
    `)

    expect(
      messages.map((message) => `${message.line}:${message.messageId}`),
    ).toEqual(['4:emptySuccessType'])
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
    ).toHaveLength(3)
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
    expectMessage(typeAwareSvelteMessages, 'emptySuccessCall')
    expectMessage(typeAwareSvelteMessages, 'emptySuccessType')
  })

  test('dedicated config enables only the named-success gate', async () => {
    const messages = await SvelteNamedSuccessContractTestHarness.lintAll(`
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

    expect(messages.map((message) => message.ruleId)).toEqual([ruleId])
  })

  test('legacy baseline contains only exact current source snapshots', () => {
    const staleEntries = namedSuccessContractBaseline.filter((entry) => {
      const source = readFileSync(join(webRoot, entry.file), 'utf8')
      return gitBlobSha1(source) !== entry.gitBlobSha1
    })

    expect(staleEntries).toEqual([])
  })

  test('the TypeScript 7 check suppresses each exact baseline snapshot', () => {
    // A baseline entry without findings is reported as stale, so an empty
    // result proves the snapshot still has findings and they are suppressed.
    for (const entry of namedSuccessContractBaseline) {
      expect(SuccessContractHarness.check(join(webRoot, entry.file))).toEqual(
        [],
      )
    }
  })
})
