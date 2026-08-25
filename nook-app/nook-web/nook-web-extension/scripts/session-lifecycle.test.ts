import { describe, expect, test } from 'bun:test'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'

describe('ensureExtensionSessionDocument', () => {
  test('uses an existing offscreen session when Chrome rejects with a string', async () => {
    let createAttempts = 0
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      offscreen: {
        createDocument: () => {
          createAttempts += 1
          return Promise.reject('single offscreen document')
        },
      },
    } as typeof chrome
    const { ensureExtensionSessionDocument } =
      await import('../src/background/service-worker/session-lifecycle')

    await ensureExtensionSessionDocument()
    expect(createAttempts).toBe(1)
  })
})

describe('openCompanionLauncherBestEffort', () => {
  test('opens the toolbar popup without creating a detached window', async () => {
    let toolbarPopupOpens = 0
    let detachedWindowOpens = 0
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://nook/popup/index.html',
      },
      action: {
        openPopup: () => {
          toolbarPopupOpens += 1
          return Promise.resolve()
        },
      },
      windows: {
        create: () => {
          detachedWindowOpens += 1
          return Promise.resolve({})
        },
      },
    } as typeof chrome
    const { openCompanionLauncher } =
      await import('../src/background/service-worker/session-lifecycle')

    await openCompanionLauncher(OpenCompanionLauncherIntent.Default)
    expect(toolbarPopupOpens).toBe(1)
    expect(detachedWindowOpens).toBe(0)
  })

  test('contains launcher failures for callers returning locked responses', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://nook/popup/index.html',
      },
      action: {
        openPopup: () => Promise.reject(new Error('toolbar unavailable')),
      },
    } as typeof chrome
    const { openCompanionLauncherBestEffort } =
      await import('../src/background/service-worker/session-lifecycle')

    expect(() =>
      openCompanionLauncherBestEffort(OpenCompanionLauncherIntent.Default),
    ).not.toThrow()
    await Promise.resolve()
  })

  test('rejects when the browser cannot open the toolbar popup', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://nook/popup/index.html',
      },
      action: {},
    } as typeof chrome
    const { openCompanionLauncher } =
      await import('../src/background/service-worker/session-lifecycle')

    await expect(
      openCompanionLauncher(OpenCompanionLauncherIntent.Default),
    ).rejects.toThrow('toolbar popup unavailable')
  })
})

describe('clearMountedAuthenticationSurfaces', () => {
  test('notifies every content-script tab and contains unavailable receivers', async () => {
    const notifiedTabIds: number[] = []
    globalThis.chrome = {
      tabs: {
        query: ((...args: Parameters<typeof chrome.tabs.query>) => {
          const callback = args[1]
          callback([{ id: 1 }, { id: 2 }, {}])
        }) as typeof chrome.tabs.query,
        sendMessage: (tabId: number) => {
          notifiedTabIds.push(tabId)
          return tabId === 2
            ? Promise.reject(new Error('content script unavailable'))
            : Promise.resolve({ ok: true })
        },
      },
    } as typeof chrome
    const { clearMountedAuthenticationSurfaces } =
      await import('../src/background/service-worker/session-lifecycle')

    await clearMountedAuthenticationSurfaces()
    expect(notifiedTabIds).toEqual([1, 2])
  })
})
