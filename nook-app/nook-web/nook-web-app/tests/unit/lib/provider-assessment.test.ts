import { draft_github_storage_args, NookVaultManager } from '$app-wasm'
import { GITHUB_PROVIDER_TYPE } from '$lib/auth/providers'
import {
  NativeProviderFailureCode,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { VaultProviderActions } from '$lib/vault/providers.svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  warnWithContext: vi.fn(),
}))

vi.mock('$lib/runtime/log', () => ({
  browserLogRuntime: {
    createLogger: () => mockLogger,
  },
}))

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
    const nativeFailure = Object.assign(
      new Error(`Request failed; Authorization: Bearer ${sentinel}`),
      { code: NativeProviderFailureCode.GitHubTokenRejected },
    )
    vi.spyOn(manager, 'assess_vault_connect').mockRejectedValue(nativeFailure)

    const args = draft_github_storage_args(
      'synthetic-invalid-token',
      'owner/vault',
    )
    const assessment = await new VaultProviderActions(
      state,
    ).assessVaultConnectStatus({
      args,
    })

    expect(assessment.isErr()).toBe(true)
    if (assessment.isErr()) {
      expect(assessment.error.kind).toBe(
        VaultStorageFailureKind.GitHubTokenRejected,
      )
      expect(assessment.error.translationKey).toBe(
        I18N_KEYS.AuthStorageGithubTokenRejected,
      )
    }
    expect(mockLogger.warnWithContext).toHaveBeenCalledOnce()
    const [logContext] = mockLogger.warnWithContext.mock.calls[0] as [
      { message: string; serializedContext: string },
    ]
    expect(logContext.message).toBe('provider vault assessment failed')
    expect(JSON.parse(logContext.serializedContext)).toEqual({
      provider_type: GITHUB_PROVIDER_TYPE,
      failure_kind: VaultStorageFailureKind.GitHubTokenRejected,
      http_status: 401,
    })
    expect(JSON.stringify(logContext)).not.toContain(sentinel)

    state.clearManager()
    manager.free()
  })
})
