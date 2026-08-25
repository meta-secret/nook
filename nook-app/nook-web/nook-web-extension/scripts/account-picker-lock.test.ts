import { describe, expect, test } from 'bun:test'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

describe('account picker lock cleanup', () => {
  test('invalidates picker authorization captured before lock begins', async () => {
    const { AccountPickerAuthorizationState } =
      await import('../src/background/service-worker/account-pickers')
    const state = new AccountPickerAuthorizationState()
    const openingGeneration = state.snapshot()

    expect(state.isCurrent(openingGeneration)).toBe(true)
    state.invalidate()
    expect(state.isCurrent(openingGeneration)).toBe(false)
  })

  test('plans removal and cancellation for both persisted picker kinds', async () => {
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

  test('scrubs in-memory pickers before persistence cleanup can fail', async () => {
    const { takePendingAccountPickerMemoryCleanup } =
      await import('../src/background/service-worker/account-pickers')
    const authenticatorRequests = new Map([
      [
        'authenticator-request',
        {
          requestId: 'authenticator-request',
          origin: 'https://login.example.test',
          tabId: 7,
          allowedVaultStoreIds: ['vault-1'],
          expiresAt: Date.now() + 60_000,
        },
      ],
    ])
    const loginRequests = new Map([
      [
        'login-request',
        {
          requestId: 'login-request',
          origin: 'https://login.example.test',
          tabId: 7,
          allowedVaultStoreIds: ['vault-1'],
          expiresAt: Date.now() + 60_000,
        },
      ],
    ])
    const cleanupArgs: Parameters<
      typeof takePendingAccountPickerMemoryCleanup
    >[0] = { authenticatorRequests, loginRequests }

    const cancellations = takePendingAccountPickerMemoryCleanup(cleanupArgs)

    expect(authenticatorRequests.size).toBe(0)
    expect(loginRequests.size).toBe(0)
    expect(cancellations.map((message) => message.payload.requestId)).toEqual([
      'authenticator-request',
      'login-request',
    ])
  })
})
