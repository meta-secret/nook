import { describe, expect, test } from 'bun:test'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

describe('account picker authorization cleanup', () => {
  test('rejects picker rehydration while cleanup is active', async () => {
    const accountPickers =
      await import('../src/background/service-worker/account-pickers')
    globalThis.chrome = {
      runtime: {},
      storage: {
        session: {
          get: (_key, callback) => {
            callback({})
          },
          set: (_items, callback) => callback(),
          remove: (_key, callback) => callback(),
        },
      },
    } as typeof chrome

    const cleanup =
      await accountPickers.beginAccountPickerAuthorizationCleanup()
    const result = await accountPickers.loadLoginPicker('persisted-request')
    await accountPickers.completeAccountPickerAuthorizationCleanup(
      cleanup.authorizationGeneration,
      true,
    )

    expect(result).toEqual({ kind: 'unavailable' })
  })

  test('rejects picker rehydration after a worker restart during cleanup', async () => {
    const { loadLoginPicker } =
      await import('../src/background/service-worker/account-pickers')
    globalThis.chrome = {
      runtime: {},
      storage: {
        session: {
          get: (_key, callback) =>
            callback({ 'nook.extension.account-picker-cleanup': true }),
        },
      },
    } as typeof chrome

    expect(await loadLoginPicker('persisted-request')).toEqual({
      kind: 'unavailable',
    })
  })

  test('closes visible picker surfaces during cleanup', async () => {
    const { clearPendingAccountPickers } =
      await import('../src/background/service-worker/account-pickers')
    const removedTabs: number[] = []
    const sentMessages: unknown[] = []
    let rejectStorage = false
    let rejectRemoval = false
    const runtime = {
      getURL: (path: string) => `chrome-extension://nook/${path}`,
    }
    globalThis.chrome = {
      runtime,
      storage: {
        session: {
          get: (callback: (items: Record<string, boolean>) => void) => {
            if (rejectStorage) {
              Object.assign(runtime, { lastError: { message: 'denied' } })
            }
            callback({})
            Reflect.deleteProperty(runtime, 'lastError')
          },
        },
      },
      tabs: {
        query: (_query, callback) =>
          callback([
            {
              id: 21,
              url: 'chrome-extension://nook/popup/index.html?intent=login-picker',
            },
          ]),
        remove: (tabId, callback) => {
          removedTabs.push(tabId as number)
          if (rejectRemoval) {
            Object.assign(runtime, { lastError: { message: 'denied' } })
          }
          callback?.()
          Reflect.deleteProperty(runtime, 'lastError')
        },
        sendMessage: (_tabId, message) => {
          sentMessages.push(message)
          return Promise.resolve()
        },
      },
    } as typeof chrome

    await clearPendingAccountPickers()

    expect(removedTabs).toEqual([21])
    expect(sentMessages).toContainEqual({
      type: ExtensionRuntimeRequestType.ClearAuthenticationSurface,
    })
    rejectStorage = true
    await expect(clearPendingAccountPickers()).rejects.toThrow(
      'account picker cleanup failed',
    )
    rejectStorage = false
    rejectRemoval = true
    await expect(clearPendingAccountPickers()).rejects.toThrow(
      'account picker cleanup failed',
    )
  })
})
