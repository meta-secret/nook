import { describe, expect, test } from 'bun:test'

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

    await expect(openCompanionLauncher()).rejects.toThrow(
      'launcher unavailable',
    )
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

    expect(() => openCompanionLauncherBestEffort()).not.toThrow()
    await Promise.resolve()
  })
})
