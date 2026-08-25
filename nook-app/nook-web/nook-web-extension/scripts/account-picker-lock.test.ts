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
})
