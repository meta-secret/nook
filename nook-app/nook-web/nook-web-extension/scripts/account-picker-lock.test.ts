import { describe, expect, test } from 'bun:test'
import { CleanupEvidence } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { WebsiteLoginCanceledMessageType } from '../src/lib/login-picker-messages'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

function browserTab(
  id: number,
  url = 'https://example.test/',
): chrome.tabs.Tab {
  return {
    id,
    url,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: true,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    lastAccessed: 0,
    groupId: -1,
  }
}

class AuthorizationStorageFixture {
  readonly runtime = {}
  readonly session = {
    get: (_key: string, callback: (items: Record<string, unknown>) => void) =>
      callback({}),
    set: (_items: Record<string, unknown>, callback: () => void) => callback(),
    remove: (_key: string, callback: () => void) => callback(),
  }

  constructor() {
    Object.assign(globalThis, {
      chrome: {
        runtime: this.runtime,
        storage: { session: this.session },
      },
    })
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
  test('binds picker delivery to the requesting frame and defaults omitted frame ids to top', async () => {
    const { AccountPickerPageTarget } =
      await import('../src/background/service-worker/account-pickers')
    const deliveries: Array<{ tabId: number; frameId: number }> = []
    Object.assign(globalThis, {
      chrome: {
        tabs: {
          sendMessage: (
            tabId: number,
            _message: unknown,
            options: chrome.tabs.MessageSendOptions,
          ) => {
            deliveries.push({ tabId, frameId: options.frameId ?? 0 })
            return Promise.resolve({ ok: options.frameId === 7 })
          },
        },
      },
    })

    expect(AccountPickerPageTarget.senderFrameId({ frameId: 7 })).toBe(7)
    expect(AccountPickerPageTarget.senderFrameId({})).toBe(0)
    const expectedSender: Parameters<
      typeof AccountPickerPageTarget.matchesSender
    >[0] = {
      tabId: 42,
      frameId: 7,
      sender: { tab: browserTab(42), frameId: 7 },
    }
    const wrongFrameSender: Parameters<
      typeof AccountPickerPageTarget.matchesSender
    >[0] = {
      ...expectedSender,
      sender: { tab: browserTab(42), frameId: 3 },
    }
    expect(AccountPickerPageTarget.matchesSender(expectedSender)).toBe(true)
    expect(AccountPickerPageTarget.matchesSender(wrongFrameSender)).toBe(false)
    const requestedFrame: Parameters<typeof AccountPickerPageTarget.send>[0] = {
      tabId: 42,
      frameId: 7,
      message: { type: 'selected' },
    }
    const wrongFrame: Parameters<typeof AccountPickerPageTarget.send>[0] = {
      tabId: 42,
      frameId: 3,
      message: { type: 'selected' },
    }

    await expect(AccountPickerPageTarget.send(requestedFrame)).resolves.toEqual(
      { ok: true },
    )
    await expect(AccountPickerPageTarget.send(wrongFrame)).resolves.toEqual({
      ok: false,
    })
    expect(deliveries).toEqual([
      { tabId: 42, frameId: 7 },
      { tabId: 42, frameId: 3 },
    ])
  })

  test('rehydrates only picker records carrying a validated frame target', async () => {
    const { accountPickerSessions } =
      await import('../src/background/service-worker/account-pickers')
    const stored = {
      'nook.extension.login-picker.framed': {
        requestId: 'framed',
        origin: 'https://idmsa.apple.test',
        tabId: 42,
        frameId: 7,
        allowedVaultStoreIds: ['vault-1'],
        expiresAt: Date.now() + 60_000,
      },
      'nook.extension.login-picker.legacy-unframed': {
        requestId: 'legacy-unframed',
        origin: 'https://idmsa.apple.test',
        tabId: 42,
        allowedVaultStoreIds: ['vault-1'],
        expiresAt: Date.now() + 60_000,
      },
    }

    expect(
      accountPickerSessions.persistedAccountPickerCleanupPlan(stored),
    ).toEqual({
      storageKeys: [
        'nook.extension.login-picker.framed',
        'nook.extension.login-picker.legacy-unframed',
      ],
      cancellations: [
        {
          tabId: 42,
          frameId: 7,
          message: {
            type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled,
            payload: {
              origin: 'https://idmsa.apple.test',
              requestId: 'framed',
            },
          },
        },
      ],
    })
  })

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
    const result =
      await accountPickers.accountPickerSessions.loadLoginPicker(
        'persisted-request',
      )
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

    expect('request' in result).toBe(false)
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
    const rejected = completing.catch((error: Error) => error)
    const callback = await removal
    const overlap = await authorization.beginAccountPickerAuthorizationCleanup()
    storage.failRemoval(callback)
    expect(await rejected).toEqual(new Error('removal denied'))
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
    const { accountPickerSessions } =
      await import('../src/background/service-worker/account-pickers')
    Object.assign(globalThis, {
      chrome: {
        runtime: {},
        storage: {
          session: {
            get: (
              _key: string,
              callback: (items: Record<string, boolean>) => void,
            ) => callback({ 'nook.extension.account-picker-cleanup': true }),
          },
        },
      },
    })

    const result =
      await accountPickerSessions.loadLoginPicker('persisted-request')
    expect('request' in result).toBe(false)
  })

  test('closes visible picker surfaces during cleanup', async () => {
    const { accountPickerSessions } =
      await import('../src/background/service-worker/account-pickers')
    const removedTabs: number[] = []
    let rejectStorage = false
    let rejectRemoval = false
    const runtime = {
      getURL: (path: string) => `chrome-extension://nook/${path}`,
    }
    Object.assign(globalThis, {
      chrome: {
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
          query: (
            _query: chrome.tabs.QueryInfo,
            callback: (tabs: chrome.tabs.Tab[]) => void,
          ) =>
            callback([
              browserTab(
                21,
                'chrome-extension://nook/popup/index.html?intent=login-picker',
              ),
            ]),
          remove: (tabId: number | number[], callback?: () => void) => {
            removedTabs.push(Array.isArray(tabId) ? (tabId[0] ?? -1) : tabId)
            if (rejectRemoval) {
              Object.assign(runtime, { lastError: { message: 'denied' } })
            }
            callback?.()
            Reflect.deleteProperty(runtime, 'lastError')
          },
          sendMessage: () => Promise.resolve(),
        },
      },
    })

    await accountPickerSessions.clearPendingAccountPickers()

    expect(removedTabs).toEqual([21])
    rejectStorage = true
    await expect(
      accountPickerSessions.clearPendingAccountPickers(),
    ).rejects.toThrow('account picker cleanup failed')
    rejectStorage = false
    rejectRemoval = true
    await expect(
      accountPickerSessions.clearPendingAccountPickers(),
    ).rejects.toThrow('account picker cleanup failed')
  })
})
