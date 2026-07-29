import { describe, expect, test } from 'bun:test'
import { ensureExtensionSessionDocument } from '../src/background/service-worker/session-lifecycle'

describe('ensureExtensionSessionDocument', () => {
  test('uses an existing offscreen session when Chrome rejects with a string', async () => {
    globalThis.chrome = {
      offscreen: {
        createDocument: () => Promise.reject('single offscreen document'),
      },
    } as typeof chrome

    await expect(ensureExtensionSessionDocument()).resolves.toBeUndefined()
  })
})
