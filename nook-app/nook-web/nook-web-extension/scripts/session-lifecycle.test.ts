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
  test('preserves launcher failures for strict unlock callers', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://nook/popup/index.html',
      },
      windows: {
        create: () => Promise.reject(new Error('launcher unavailable')),
      },
    } as typeof chrome
    const { openCompanionLauncher } =
      await import('../src/background/service-worker/session-lifecycle')

    await expect(
      openCompanionLauncher(OpenCompanionLauncherIntent.Default),
    ).rejects.toThrow('launcher unavailable')
  })

  test('contains launcher failures for callers returning locked responses', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://nook/popup/index.html',
      },
      windows: {
        create: () => Promise.reject(new Error('launcher unavailable')),
      },
    } as typeof chrome
    const { openCompanionLauncherBestEffort } =
      await import('../src/background/service-worker/session-lifecycle')

    expect(() =>
      openCompanionLauncherBestEffort(OpenCompanionLauncherIntent.Default),
    ).not.toThrow()
    await Promise.resolve()
  })
})

describe('authentication surface notifications', () => {
  test('refreshes every available tab and tolerates tabs without ids', async () => {
    const messages: Array<{ tabId: number; type: string }> = []
    globalThis.chrome = {
      tabs: {
        query: (_query, callback) => callback([{ id: 7 }, {}, { id: 11 }]),
        sendMessage: (tabId, message) => {
          messages.push({ tabId, type: message.type })
          return Promise.resolve()
        },
      },
    } as unknown as typeof chrome
    const { refreshAuthenticationSurfaces } =
      await import('../src/background/service-worker/session-lifecycle')

    await refreshAuthenticationSurfaces()

    expect(messages).toEqual([
      { tabId: 7, type: 'nook:refresh-authentication-surfaces' },
      { tabId: 11, type: 'nook:refresh-authentication-surfaces' },
    ])
  })

  test('contains absent-tab enumeration failures during cleanup', async () => {
    globalThis.chrome = {
      tabs: {
        query: () => {
          throw new Error('tabs unavailable')
        },
      },
    } as unknown as typeof chrome
    const { clearMountedAuthenticationSurfaces } =
      await import('../src/background/service-worker/session-lifecycle')

    await clearMountedAuthenticationSurfaces()
  })
})
