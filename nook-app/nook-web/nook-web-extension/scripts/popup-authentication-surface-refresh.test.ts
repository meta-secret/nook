import { describe, expect, mock, test } from 'bun:test'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import { refreshInvokingAuthenticationSurface } from '../src/popup/authentication-surface-refresh'

describe('popup authentication surface refresh', () => {
  test('refreshes only the active tab in the invoking window', () => {
    const sendMessage = mock(() => Promise.resolve())
    const query = mock(
      (
        _query: chrome.tabs.QueryInfo,
        callback: (tabs: chrome.tabs.Tab[]) => void,
      ) => {
        callback([
          { id: 42, active: true },
          { id: 84, active: false },
        ] as chrome.tabs.Tab[])
      },
    )
    globalThis.chrome = {
      tabs: { query, sendMessage },
    } as unknown as typeof chrome

    refreshInvokingAuthenticationSurface()

    expect(query).toHaveBeenCalledWith(
      { active: true, currentWindow: true },
      expect.any(Function),
    )
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
    })
  })
})
