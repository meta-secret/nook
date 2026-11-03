import {
  draft_storage_args,
  NookVaultManager,
  s3_provider_draft,
  type ProviderDraft,
  type StorageConnection,
} from '$app-wasm'
import {
  NativeVaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { S3ConnectionFixture } from '../s3-connection-fixture'
import { ProviderDraftFixture } from '../provider-fixtures'
import { VaultProviderActions } from '$lib/vault/providers.svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import type { SerializedLogContext } from '$lib/runtime/log'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  warnWithContext: vi.fn<(context: SerializedLogContext) => void>(),
}))

vi.mock('$lib/runtime/log', () => ({
  browserLogRuntime: {
    createLogger: () => mockLogger,
  },
}))

/** The connection a complete draft hands the manager. */
function readyArgs(draft: ProviderDraft): StorageConnection {
  const staged = draft_storage_args(draft)
  switch (staged.state) {
    case 'ready':
      return staged.connection
    case 'incomplete':
      throw new Error(`expected a complete draft, missing ${staged.gap}`)
  }
}

describe('GitHub provider assessment failure', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockLogger.warnWithContext.mockClear()
  })

  test('uses the typed code for a safe rejection status and excludes the native message from logs', async () => {
    const state = VaultStateTestFixture.create()
    const manager = new NookVaultManager()
    state.openManager(manager)
    VaultStateTestFixture.runStorageImmediately(state)

    const sentinel = 'unit-test-secret-that-must-not-be-logged'
    const nativeFailure = new Error(
      `${I18N_KEYS.AuthStorageGithubTokenRejected}; Authorization: Bearer ${sentinel}`,
    )
    vi.spyOn(manager, 'assess_vault_connect').mockRejectedValue(nativeFailure)

    const args = readyArgs(ProviderDraftFixture.githubEntered())
    const assessment = await new VaultProviderActions(
      state,
    ).assessVaultConnectStatus({
      args,
    })

    expect(assessment.isErr()).toBe(true)
    if (assessment.isErr()) {
      expect(assessment.error.kind).toBe(
        VaultStorageFailureKind.OperationFailed,
      )
      expect(assessment.error.translationKey).toBe(
        I18N_KEYS.AuthStorageGithubTokenRejected,
      )
    }
    expect(mockLogger.warnWithContext).toHaveBeenCalledOnce()
    const logContextCall = mockLogger.warnWithContext.mock.calls[0]
    if (!logContextCall) throw new Error('expected a logged warning context')
    const [logContext] = logContextCall
    expect(logContext.message).toBe('provider vault assessment failed')
    expect(JSON.parse(logContext.serializedContext)).toEqual({
      provider_type: 'github',
      failure_kind: VaultStorageFailureKind.OperationFailed,
      // Rust reads the rejection's translation key as an unauthorized answer.
      cause: 'unauthorized',
    })
    expect(JSON.stringify(logContext)).not.toContain(sentinel)

    state.clearManager()
    manager.free()
  })
})

describe('S3 provider assessment failure', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockLogger.warnWithContext.mockClear()
  })

  test('a refused key says what to check and logs no secret', async () => {
    const state = VaultStateTestFixture.create()
    const manager = new NookVaultManager()
    state.openManager(manager)
    VaultStateTestFixture.runStorageImmediately(state)
    // Rust rejects a refused S3 key with this message and no code.
    const refusal = new Error(I18N_KEYS.ErrorsS3KeyAccessDenied)
    vi.spyOn(manager, 'assess_vault_connect').mockRejectedValue(refusal)
    const args = readyArgs(
      s3_provider_draft(S3ConnectionFixture.configuration()),
    )

    const assessment = await new VaultProviderActions(
      state,
    ).assessVaultConnectStatus({ args })

    expect(assessment.isErr()).toBe(true)
    if (assessment.isErr()) {
      expect(assessment.error.kind).toBe(
        VaultStorageFailureKind.OperationFailed,
      )
      expect(assessment.error.translationKey).toBe(
        I18N_KEYS.ErrorsS3KeyAccessDenied,
      )
    }
    const logContextCall = mockLogger.warnWithContext.mock.calls[0]
    if (!logContextCall) throw new Error('expected a logged warning context')
    const [logContext] = logContextCall
    expect(JSON.parse(logContext.serializedContext)).toEqual({
      provider_type: 's3',
      failure_kind: VaultStorageFailureKind.OperationFailed,
      cause: 'forbidden',
    })
    expect(JSON.stringify(logContext)).not.toContain(S3ConnectionFixture.SECRET)

    state.clearManager()
    manager.free()
  })

  test('only the Rust reading of the message names an S3 refusal', () => {
    const failure = new NativeVaultStorageFailure(
      new Error(I18N_KEYS.ErrorsS3KeyAccessDenied),
    )

    expect(failure.translationKey).toBe(I18N_KEYS.ErrorsS3KeyAccessDenied)
    expect(
      new NativeVaultStorageFailure(
        new Error('S3 request failed with status 503'),
      ).translationKey,
    ).toBe(I18N_KEYS.AuthStorageSyncFailed)
  })
})
