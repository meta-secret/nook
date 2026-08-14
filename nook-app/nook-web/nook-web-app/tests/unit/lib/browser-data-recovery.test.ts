import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  quiesceOtherTabsForLocalRecovery,
  requireLocalDataRecoverySupport,
} from '$lib/runtime/browser-data'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('local data recovery support', () => {
  test('rejects missing Web Locks before contacting peer tabs', async () => {
    const broadcastChannel = vi.fn()
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('BroadcastChannel', broadcastChannel)

    expect(() => requireLocalDataRecoverySupport()).toThrow(
      'Safe cross-tab local data deletion is unavailable',
    )
    await expect(quiesceOtherTabsForLocalRecovery()).rejects.toThrow(
      'Safe cross-tab local data deletion is unavailable',
    )
    expect(broadcastChannel).not.toHaveBeenCalled()
  })
})
