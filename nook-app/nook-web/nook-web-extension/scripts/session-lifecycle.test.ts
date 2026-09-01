import { describe, expect, mock, test } from 'bun:test'
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
    const create = mock(() => Promise.reject(new Error('launcher unavailable')))
    globalThis.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://nook/popup/index.html',
      },
      tabs: { query: (_query, callback) => callback([{ id: 42 }]) },
      windows: {
        create,
      },
    } as typeof chrome
    const { openCompanionLauncher } =
      await import('../src/background/service-worker/session-lifecycle')

    await expect(
      openCompanionLauncher(OpenCompanionLauncherIntent.Default),
    ).rejects.toThrow('launcher unavailable')
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      url: 'chrome-extension://nook/popup/index.html',
    })
  })

  test('contains launcher failures for callers returning locked responses', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://nook/popup/index.html',
      },
      tabs: { query: (_query, callback) => callback([]) },
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
