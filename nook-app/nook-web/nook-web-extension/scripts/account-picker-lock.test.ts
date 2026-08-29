import { describe, expect, test } from 'bun:test'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

describe('account picker authorization cleanup', () => {
  test('holds one invalid generation across cleanup', async () => {
    const { AccountPickerAuthorizationState } =
      await import('../src/background/service-worker/account-pickers')
    const state = new AccountPickerAuthorizationState()
    const openingGeneration = state.snapshot()

    const cleanupGeneration = state.beginCleanup()
    expect(state.isCurrent(openingGeneration)).toBe(false)
    expect(state.beginCleanup()).toBe(cleanupGeneration)
    expect(state.isCurrent(cleanupGeneration)).toBe(false)

    state.completeCleanup(cleanupGeneration)
    expect(state.isCurrent(cleanupGeneration)).toBe(false)
    state.completeCleanup(cleanupGeneration)
    expect(state.isCurrent(cleanupGeneration)).toBe(true)
  })

  test('plans cancellation and removal for both persisted picker kinds', async () => {
    const { persistedAccountPickerCleanupPlan } =
      await import('../src/background/service-worker/account-pickers')
    const storedPickers = {
      'nook.extension.authenticator-picker.authenticator-request': {
        requestId: 'authenticator-request',
        origin: 'https://login.example.test',
        tabId: 7,
        allowedVaultStoreIds: ['vault-1'],
        expiresAt: Date.now() + 60_000,
      },
      'nook.extension.login-picker.login-request': {
        requestId: 'login-request',
        origin: 'https://login.example.test',
        tabId: 7,
        allowedVaultStoreIds: ['vault-1'],
        expiresAt: Date.now() + 60_000,
      },
    }

    expect(persistedAccountPickerCleanupPlan(storedPickers)).toEqual({
      storageKeys: Object.keys(storedPickers),
      cancellations: [
        {
          type: 'nook:website-authenticator-canceled',
          payload: {
            origin: 'https://login.example.test',
            requestId: 'authenticator-request',
          },
        },
        {
          type: 'nook:website-login-canceled',
          payload: {
            origin: 'https://login.example.test',
            requestId: 'login-request',
          },
        },
      ],
    })
  })

  test('rejects picker rehydration while cleanup is active', async () => {
    const accountPickers =
      await import('../src/background/service-worker/account-pickers')
    let storageReads = 0
    globalThis.chrome = {
      storage: {
        session: {
          get: () => {
            storageReads += 1
          },
        },
      },
    } as typeof chrome

    const generation = accountPickers.beginAccountPickerAuthorizationCleanup()
    const result = await accountPickers.loadLoginPicker('persisted-request')
    accountPickers.completeAccountPickerAuthorizationCleanup(generation)

    expect(result).toEqual({ kind: 'unavailable' })
    expect(storageReads).toBe(0)
  })

  test('scrubs in-memory requests before persistence cleanup', async () => {
    const { takePendingAccountPickerMemoryCleanup } =
      await import('../src/background/service-worker/account-pickers')
    const request = {
      requestId: 'request',
      origin: 'https://login.example.test',
      tabId: 7,
      allowedVaultStoreIds: ['vault-1'],
      expiresAt: Date.now() + 60_000,
    }
    const authenticatorRequests = new Map([['request', request]])
    const loginRequests = new Map([['request', request]])

    const cancellations = takePendingAccountPickerMemoryCleanup({
      authenticatorRequests,
      loginRequests,
    })

    expect(authenticatorRequests.size).toBe(0)
    expect(loginRequests.size).toBe(0)
    expect(cancellations).toHaveLength(2)
  })
})
