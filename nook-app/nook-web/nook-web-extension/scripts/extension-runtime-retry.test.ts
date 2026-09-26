import { describe, expect, mock, test } from 'bun:test'
import { ExtensionSessionRuntimeClosed } from '../src/lib/nook-wasm'
import { retryClosedExtensionSessionOnce } from '../src/lib/extension-runtime-retry'

describe('extension popup session startup', () => {
  test('issues one fresh request after a concurrent session close', async () => {
    const operation = mock(async () => {
      if (operation.mock.calls.length === 1)
        throw new ExtensionSessionRuntimeClosed()
      return 'ready'
    })

    expect(await retryClosedExtensionSessionOnce(operation)).toBe('ready')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  test('does not retry a persistent closed session', async () => {
    const operation = mock(async () => {
      throw new ExtensionSessionRuntimeClosed()
    })

    expect(retryClosedExtensionSessionOnce(operation)).rejects.toBeInstanceOf(
      ExtensionSessionRuntimeClosed,
    )
    expect(operation).toHaveBeenCalledTimes(2)
  })

  test('does not retry another startup failure', async () => {
    const failure = new Error('WASM initialization failed')
    const operation = mock(async () => {
      throw failure
    })

    expect(retryClosedExtensionSessionOnce(operation)).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
