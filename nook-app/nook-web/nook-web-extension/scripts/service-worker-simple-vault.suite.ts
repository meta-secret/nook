import { describe, expect, mock, test } from 'bun:test'
import { OpenSimpleVaultMessageType } from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import {
  flushResponses,
  lifecycleDependencies,
} from './service-worker-routing-test-support'

class VaultLaunchCompletion {
  readonly operation: Promise<void>
  complete: () => void = () => {}
  constructor() {
    this.operation = new Promise((resolve) => {
      this.complete = resolve
    })
  }
}

describe('Simple Vault launch routing', () => {
  test('keeps the channel open and responds only after launch completes', async () => {
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const launch = new VaultLaunchCompletion()
    const sendResponse = mock(() => {})
    expect(
      routeExtensionLifecycleMessage({
        dependencies: {
          ...lifecycleDependencies,
          openSimpleVault: () => launch.operation,
        },
        message: { type: OpenSimpleVaultMessageType.NookOpenSimpleVault },
        sender: { id: 'nook-extension' },
        sendResponse,
      }),
    ).toBe(true)
    await flushResponses()
    expect(sendResponse).not.toHaveBeenCalled()
    launch.complete()
    await flushResponses()
    expect(sendResponse).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
  })

  test('reports launch rejection without an early success response', async () => {
    const { routeExtensionLifecycleMessage } =
      await import('../src/background/service-worker/extension-lifecycle-routing')
    const sendResponse = mock(() => {})
    expect(
      routeExtensionLifecycleMessage({
        dependencies: {
          ...lifecycleDependencies,
          openSimpleVault: () => Promise.reject('launch unavailable'),
        },
        message: { type: OpenSimpleVaultMessageType.NookOpenSimpleVault },
        sender: { id: 'nook-extension' },
        sendResponse,
      }),
    ).toBe(true)
    expect(sendResponse).not.toHaveBeenCalled()
    await flushResponses()
    expect(sendResponse).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      reason: 'launcher-failed',
    })
  })
})
