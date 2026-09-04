import { describe, expect, test } from 'bun:test'
import { CleanupEvidence } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

class AuthorizationStorageFixture {
  readonly runtime = {}
  readonly session = {
    get: (_key: string, callback: (items: Record<string, unknown>) => void) =>
      callback({}),
    set: (_items: Record<string, unknown>, callback: () => void) => callback(),
    remove: (_key: string, callback: () => void) => callback(),
  }

  constructor() {
    globalThis.chrome = {
      runtime: this.runtime,
      storage: { session: this.session },
    } as typeof chrome
  }

  holdRemoval(): Promise<() => void> {
    return new Promise((resolve) => {
      this.session.remove = (_key, callback) => resolve(callback)
    })
  }

  finishRemoval(callback: () => void): void {
    this.session.remove = (_key, complete) => complete()
    callback()
  }

  failRemoval(callback: () => void): void {
    Object.assign(this.runtime, { lastError: { message: 'removal denied' } })
    this.finishRemoval(callback)
    Reflect.deleteProperty(this.runtime, 'lastError')
  }
}

describe('account picker authorization cleanup', () => {
  test('shares initialization and successor handles across overlapping cleanups', async () => {
    const accountPickers =
      await import('../src/background/service-worker/account-pickers')
    new AuthorizationStorageFixture()

    const [cleanup, overlap] = await Promise.all([
      accountPickers.beginAccountPickerAuthorizationCleanup(),
      accountPickers.beginAccountPickerAuthorizationCleanup(),
    ])
    expect(overlap.authorizationGeneration).toBe(
      cleanup.authorizationGeneration,
    )
    const result = await accountPickers.loadLoginPicker('persisted-request')
    await accountPickers.completeAccountPickerAuthorizationCleanup(
      cleanup.authorizationGeneration,
      CleanupEvidence.Full,
    )
    expect(
      accountPickers.accountPickerAuthorizationIsCurrent(
        cleanup.authorizationGeneration,
      ),
    ).toBe(false)
    await accountPickers.completeAccountPickerAuthorizationCleanup(
      overlap.authorizationGeneration,
      CleanupEvidence.Full,
    )
    expect(
      accountPickers.accountPickerAuthorizationIsCurrent(
        overlap.authorizationGeneration,
      ),
    ).toBe(true)

    expect(result).toEqual({ kind: 'unavailable' })
  })

  test('reacquires the successor after marker removal overlaps another cleanup', async () => {
    const authorization =
      await import('../src/background/service-worker/account-picker-authorization')
    const storage = new AuthorizationStorageFixture()
    const cleanup = await authorization.beginAccountPickerAuthorizationCleanup()
    const removal = storage.holdRemoval()
    const completing = authorization.completeAccountPickerAuthorizationCleanup(
      cleanup.authorizationGeneration,
      CleanupEvidence.Full,
    )
    const callback = await removal
    const overlap = await authorization.beginAccountPickerAuthorizationCleanup()
    storage.finishRemoval(callback)
    await completing
    expect(
      authorization.accountPickerAuthorizationIsCurrent(
        cleanup.authorizationGeneration,
      ),
    ).toBe(false)
    await authorization.completeAccountPickerAuthorizationCleanup(
      overlap.authorizationGeneration,
      CleanupEvidence.Full,
    )
    expect(
      authorization.accountPickerAuthorizationIsCurrent(
        overlap.authorizationGeneration,
      ),
    ).toBe(true)
  })

  test('releases the current successor when overlapping marker removal fails', async () => {
    const authorization =
      await import('../src/background/service-worker/account-picker-authorization')
    const storage = new AuthorizationStorageFixture()
    const cleanup = await authorization.beginAccountPickerAuthorizationCleanup()
    const removal = storage.holdRemoval()
    const completing = authorization.completeAccountPickerAuthorizationCleanup(
      cleanup.authorizationGeneration,
      CleanupEvidence.Full,
    )
    const rejected = expect(completing).rejects.toThrow('removal denied')
    const callback = await removal
    const overlap = await authorization.beginAccountPickerAuthorizationCleanup()
    storage.failRemoval(callback)
    await rejected
    await authorization.completeAccountPickerAuthorizationCleanup(
      overlap.authorizationGeneration,
      CleanupEvidence.Partial,
    )
    expect(
      authorization.accountPickerAuthorizationIsCurrent(
        overlap.authorizationGeneration,
      ),
    ).toBe(false)
    const fullCleanup =
      await authorization.beginAccountPickerAuthorizationCleanup()
    await authorization.completeAccountPickerAuthorizationCleanup(
      fullCleanup.authorizationGeneration,
      CleanupEvidence.Full,
    )
    expect(
      authorization.accountPickerAuthorizationIsCurrent(
        fullCleanup.authorizationGeneration,
      ),
    ).toBe(true)
  })

  test('preserves the current handle after stale completion and release', async () => {
    const authorization =
      await import('../src/background/service-worker/account-picker-authorization')
    new AuthorizationStorageFixture()
    const old = await authorization.accountPickerAuthorizationGeneration()
    const cleanup = await authorization.beginAccountPickerAuthorizationCleanup()
    const rejected =
      await authorization.completeAccountPickerAuthorizationCleanup(
        old,
        CleanupEvidence.Full,
      )
    expect(rejected).toHaveProperty('error')
    authorization.releaseAccountPickerAuthorizationCleanup(old)
    expect(
      authorization.accountPickerAuthorizationIsCurrent(
        cleanup.authorizationGeneration,
      ),
    ).toBe(false)
    await authorization.completeAccountPickerAuthorizationCleanup(
      cleanup.authorizationGeneration,
      CleanupEvidence.Partial,
    )
    expect(
      authorization.accountPickerAuthorizationIsCurrent(
        cleanup.authorizationGeneration,
      ),
    ).toBe(true)
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
        sendMessage: () => Promise.resolve(),
      },
    } as typeof chrome

    await clearPendingAccountPickers()

    expect(removedTabs).toEqual([21])
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
