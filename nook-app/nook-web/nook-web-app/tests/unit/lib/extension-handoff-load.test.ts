import { describe, expect, test, vi } from 'vitest'
import { loadDb } from '../../../../nook-web-shared/src/vault-app/lib/vault/secrets'
import { persistProviders } from '../../../../nook-web-shared/src/vault-app/lib/vault/providers'
import { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'

describe('extension identity vault load', () => {
  test('bypasses the outer verification guard, validates the grant, and skips site providers', async () => {
    const connect = vi.fn(async () => [])
    const validate = vi.fn(async () => undefined)
    const loadProviders = vi.fn(async () => undefined)
    const ensureOAuthTokensFresh = vi.fn(async () => undefined)
    const ensureProviderSaved = vi.fn(async () => true)
    const promoteSessionVaultToLocalIfNeeded = vi.fn(async () => undefined)
    const state = {
      isInitializing: false,
      isVerifying: true,
      isAuthenticated: false,
      manager: {
        connect,
        validateExtensionDeviceIdentityForHandoff: validate,
      },
      errorMsg: '',
      dismissSuccess: vi.fn(),
      initDeviceIdentity: vi.fn(async () => undefined),
      ensureOAuthTokensFresh,
      loginSetupType: '',
      syncProviders: [],
      pendingConnectRecovery: 'none',
      assessVaultConnectStatus: vi.fn(async () => 'ready'),
      handleRemoteVaultAssessStatus: vi.fn(async () => false),
      stagedRemoteStorageArgs: vi.fn(() => undefined),
      connectStorageArgs: vi.fn(() => ['local', '', '']),
      enqueueStorage: async <T>(operation: () => Promise<T>) => operation(),
      secrets: [],
      syncOAuthRemoteRefFromManager: vi.fn(),
      ensureProviderSaved,
      loadProviders,
      promoteSessionVaultToLocalIfNeeded,
      refreshPasswordEntriesList: vi.fn(async () => false),
      hydrateMultiDeviceState: vi.fn(async () => undefined),
      markVaultUnlocked(this: { isAuthenticated: boolean }) {
        this.isAuthenticated = true
      },
      storageMode: 'local',
      showSuccess: vi.fn(),
      t: vi.fn((key: string) => key),
      syncFromStorage: vi.fn(async () => undefined),
      startIdleSessionTracking: vi.fn(),
      startVaultSync: vi.fn(),
      resolveErrorMessage: vi.fn((message: string) => message),
    } as unknown as VaultState

    await loadDb(state, {
      allowActiveVerification: true,
      loadSiteProviders: false,
      validateExtensionIdentity: true,
    })

    expect(connect).toHaveBeenCalledOnce()
    expect(validate).toHaveBeenCalledOnce()
    expect(ensureOAuthTokensFresh).not.toHaveBeenCalled()
    expect(ensureProviderSaved).not.toHaveBeenCalled()
    expect(loadProviders).not.toHaveBeenCalled()
    expect(promoteSessionVaultToLocalIfNeeded).not.toHaveBeenCalled()
    expect(state.isAuthenticated).toBe(true)
  })

  test('rejects before replacing an already-open vault session', async () => {
    const adopt = vi.fn()
    const state = {
      manager: { adoptExtensionDeviceIdentityForHandoff: adopt },
      isVerifying: false,
      isInitializing: false,
      isAuthenticated: true,
      errorMsg: '',
    } as unknown as VaultState

    const unlocked =
      await VaultState.prototype.unlockWithExtensionDeviceIdentity.call(
        state,
        'identity-secret',
        'signing-seed',
      )

    expect(unlocked).toBe(false)
    expect(adopt).not.toHaveBeenCalled()
    expect(state.isAuthenticated).toBe(true)
    expect(state.isVerifying).toBe(false)
  })

  test('clears decrypted manager state after handoff validation fails', async () => {
    const resetVaultSession = vi.fn()
    const lockDeviceProtection = vi.fn(async () => undefined)
    const state = {
      manager: {
        adoptExtensionDeviceIdentityForHandoff: vi.fn(),
        resetVaultSession,
      },
      isVerifying: false,
      isInitializing: false,
      isAuthenticated: false,
      deviceProtectionStatus: 'passkey',
      deviceAuthorizationInProgress: false,
      errorMsg: '',
      enqueueStorage: async <T>(operation: () => T | Promise<T>) => operation(),
      continueInitializationAfterDeviceUnlock: vi.fn(async () => {
        throw new Error('grant rejected')
      }),
      lockDeviceProtection,
      t: vi.fn((key: string) => key),
    } as unknown as VaultState

    const unlocked =
      await VaultState.prototype.unlockWithExtensionDeviceIdentity.call(
        state,
        'identity-secret',
        'signing-seed',
      )

    expect(unlocked).toBe(false)
    expect(resetVaultSession).toHaveBeenCalledOnce()
    expect(lockDeviceProtection).toHaveBeenCalledOnce()
    expect(state.errorMsg).toBe('extension.unlock.handoff_failed')
  })

  test('blocks provider snapshot writes in extension-backed sessions', async () => {
    const state = {
      manager: { authProviderPersistenceAllowed: false },
      errorMsg: '',
      t: vi.fn((key: string) => key),
    } as unknown as VaultState

    await expect(persistProviders(state)).rejects.toThrow(
      'extension.unlock.provider_changes_blocked',
    )
    expect(state.errorMsg).toBe('extension.unlock.provider_changes_blocked')
  })
})
