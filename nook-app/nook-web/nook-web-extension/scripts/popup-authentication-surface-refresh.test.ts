import { expect, mock, test } from 'bun:test'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import { refreshInvokingAuthenticationSurface } from '../src/popup/authentication-surface-refresh'

test('refreshes the website tab encoded before the popup window opened', () => {
  const sendMessage = mock(() => Promise.resolve())
  const query = mock((_query, callback) => callback([{ id: 84 }]))
  globalThis.chrome = {
    tabs: { query, sendMessage },
  } as unknown as typeof chrome

  refreshInvokingAuthenticationSurface('?invokingTabId=42')

  expect(query).not.toHaveBeenCalled()
  expect(sendMessage).toHaveBeenCalledWith(42, {
    type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces,
  })
})
