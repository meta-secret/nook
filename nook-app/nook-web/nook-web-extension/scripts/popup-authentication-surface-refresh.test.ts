import { expect, mock, test } from 'bun:test'
import { refreshInvokingAuthenticationSurface } from '../src/popup/authentication-surface-refresh'

test('targets companion-window and direct-toolbar website tabs', () => {
  const sendMessage = mock(() => Promise.reject(new Error('restricted page')))
  const query = mock((_query, callback) => callback([{ id: 84 }]))
  globalThis.chrome = {
    tabs: { query, sendMessage },
  } as unknown as typeof chrome

  refreshInvokingAuthenticationSurface('?invokingTabId=42')

  expect(query).not.toHaveBeenCalled()
  refreshInvokingAuthenticationSurface('')

  expect(query).toHaveBeenCalledTimes(1)
  refreshInvokingAuthenticationSurface('?invokingTabId=invalid')
  expect(query).toHaveBeenCalledTimes(1)
  expect(sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([42, 84])
})
