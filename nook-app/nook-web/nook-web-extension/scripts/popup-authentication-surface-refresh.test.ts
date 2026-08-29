import { describe, expect, mock, test } from 'bun:test'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import { refreshInvokingAuthenticationSurface } from '../src/popup/authentication-surface-refresh'

describe('popup authentication surface refresh', () => {
  test('asks the service worker to refresh trusted authentication surfaces', () => {
    const sendMessage = mock(
      (_message: unknown, callback: () => void) => callback(),
    )
    globalThis.chrome = {
      runtime: {
        sendMessage,
        lastError: undefined,
      },
    } as unknown as typeof chrome

    refreshInvokingAuthenticationSurface()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      { type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces },
      expect.any(Function),
    )
  })
})
