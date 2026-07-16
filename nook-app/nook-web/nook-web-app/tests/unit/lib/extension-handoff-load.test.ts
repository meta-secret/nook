import { describe, expect, test, vi } from 'vitest'
import { loadDb } from '../../../../nook-web-shared/src/vault-app/lib/vault/secrets'
import type { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'

describe('extension identity vault load', () => {
  test('bypasses the outer verification guard, validates the grant, and skips site providers', async () => {
    const connect = vi.fn(async () => [])
    const validate = vi.fn(async () => undefined)
    const loadProviders = vi.fn(async () => undefined)
    const ensureOAuthTokensFresh = vi.fn(async () => undefined)
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
      ensureProviderSaved: vi.fn(async () => true),
      loadProviders,
      promoteSessionVaultToLocalIfNeeded: vi.fn(async () => undefined),
      refreshPasswordEntriesList: vi.fn(async () => false),
      hydrateMultiDeviceState: vi.fn(async () => undefined),
      markVaultUnlocked() {
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
    expect(loadProviders).not.toHaveBeenCalled()
    expect(state.isAuthenticated).toBe(true)
  })
})
