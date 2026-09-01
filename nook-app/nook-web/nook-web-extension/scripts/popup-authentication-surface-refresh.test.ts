import { expect, mock, test } from 'bun:test'
import {
  refreshInvokingAuthenticationSurface,
  refreshInvokingAuthenticationSurfaceAfterUnlock,
} from '../src/popup/authentication-surface-refresh'
test('invalidates unlock state before targeting companion and toolbar tabs', async () => {
  const events: string[] = []
  const sendMessage = mock((tabId) => {
    events.push(`refresh-${tabId}`)
    return Promise.reject(new Error('restricted page'))
  })
  const query = mock((_query, callback) => callback([{ id: 84 }]))
  globalThis.chrome = {
    runtime: { sendMessage: mock(async () => events.push('invalidate')) },
    tabs: { query, sendMessage },
  } as unknown as typeof chrome
  await refreshInvokingAuthenticationSurfaceAfterUnlock('?invokingTabId=42')
  expect(query).not.toHaveBeenCalled()
  expect(events).toEqual(['invalidate', 'refresh-42'])
  refreshInvokingAuthenticationSurface('')
  expect(query).toHaveBeenCalledTimes(1)
  refreshInvokingAuthenticationSurface('?invokingTabId=invalid')
  expect(query).toHaveBeenCalledTimes(1)
  expect(sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([42, 84])
})
