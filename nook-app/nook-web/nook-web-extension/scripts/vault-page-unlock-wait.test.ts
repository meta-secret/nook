import { afterEach, describe, expect, test } from 'bun:test'
import {
  VAULT_PAGE_UNLOCK_WAIT_MS,
  VaultPageUnlockWait,
} from '../src/lib/vault-page-unlock-wait'
import { extensionTestBrowserHost } from './extension-test-browser-host'

type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
) => void

/** The extension's session storage, held in memory and announcing changes. */
function installSessionStorage() {
  const items = new Map<string, number>()
  const listeners = new Set<ChangeListener>()
  const announce = (key: string) => {
    for (const listener of listeners) listener({ [key]: {} })
  }
  const session = {
    set: async (values: Record<string, number>) => {
      for (const [key, value] of Object.entries(values)) {
        items.set(key, value)
        announce(key)
      }
    },
    remove: async (key: string) => {
      items.delete(key)
      announce(key)
    },
    get: async (key: string) =>
      items.has(key) ? { [key]: items.get(key) } : {},
    onChanged: {
      addListener: (listener: ChangeListener) => listeners.add(listener),
      removeListener: (listener: ChangeListener) => listeners.delete(listener),
    },
  }
  Object.assign(globalThis, {
    chrome: { ...extensionTestBrowserHost, storage: { session } },
  })
  return { listeners }
}

afterEach(() => {
  Object.assign(globalThis, { chrome: extensionTestBrowserHost })
})

describe('vault page unlock wait', () => {
  test('a page asking a locked extension waits for the page timeout', async () => {
    installSessionStorage()

    await VaultPageUnlockWait.begin(1_000)

    expect(await VaultPageUnlockWait.until()).toBe(
      1_000 + VAULT_PAGE_UNLOCK_WAIT_MS,
    )
  })

  test('an unlock ends the wait, and no wait reads as none', async () => {
    installSessionStorage()
    expect(await VaultPageUnlockWait.until()).toBe(0)

    await VaultPageUnlockWait.begin(1_000)
    await VaultPageUnlockWait.end()

    expect(await VaultPageUnlockWait.until()).toBe(0)
  })

  test('an open panel hears a wait begin and end, until it stops following', async () => {
    const storage = installSessionStorage()
    let changes = 0
    const stop = VaultPageUnlockWait.follow(() => {
      changes += 1
    })

    await VaultPageUnlockWait.begin(1_000)
    await VaultPageUnlockWait.end()
    expect(changes).toBe(2)

    stop()
    expect(storage.listeners.size).toBe(0)
  })
})
