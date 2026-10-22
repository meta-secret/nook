import { describe, expect, mock, test } from 'bun:test'
import {
  announceExtensionSessionLocked,
  type ExtensionSessionLockNoticeBrowser,
} from '../src/background/service-worker/extension-session-lock-notice'

function lockNoticeBrowser(
  overrides: Partial<ExtensionSessionLockNoticeBrowser>,
): ExtensionSessionLockNoticeBrowser {
  const browser: ExtensionSessionLockNoticeBrowser = {
    vaultOrigins: () => ['https://simple.example.test/*'],
    vaultTabIds: () => Promise.resolve([4, 9]),
    notifyTab: () => Promise.resolve(),
    ...overrides,
  }
  return browser
}

describe('extension session lock notice', () => {
  test('tells every open vault tab, even when one of them cannot hear it', async () => {
    const vaultTabIds = mock(() => Promise.resolve([4, 9]))
    const notifyTab = mock((tabId: number) =>
      tabId === 4
        ? Promise.reject(new Error('no receiver'))
        : Promise.resolve(),
    )
    await announceExtensionSessionLocked(
      lockNoticeBrowser({ vaultTabIds, notifyTab }),
    )
    expect(vaultTabIds).toHaveBeenCalledWith(['https://simple.example.test/*'])
    expect(notifyTab).toHaveBeenCalledWith(4)
    expect(notifyTab).toHaveBeenCalledWith(9)
  })

  test('looks for no tabs when the extension accepts no vault origin', async () => {
    const vaultTabIds = mock(() => Promise.resolve([4]))
    await announceExtensionSessionLocked(
      lockNoticeBrowser({ vaultOrigins: () => [], vaultTabIds }),
    )
    expect(vaultTabIds).not.toHaveBeenCalled()
  })
})
