import { describe, expect, test } from 'bun:test'

describe('ensureExtensionSessionDocument', () => {
  test('uses an existing offscreen session when Chrome rejects with a string', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      offscreen: {
        createDocument: () => Promise.reject('single offscreen document'),
      },
    } as typeof chrome
    const { ensureExtensionSessionDocument } =
      await import('../src/background/service-worker/session-lifecycle')

    await expect(ensureExtensionSessionDocument()).resolves.toBeUndefined()
  })
})
