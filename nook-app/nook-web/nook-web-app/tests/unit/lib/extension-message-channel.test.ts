import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  ExtensionMessageChannel,
  ExtensionMessageResponseWaitKind,
  type ChromeExtensionRuntimeResponse,
  type ExtensionMessageRequest,
} from '$lib/extension/extension-message-channel'
import { browserLogRuntime, type ScopedLogger } from '$lib/runtime/log'
import {
  ExtensionPairedVaultUnlockRequestMessageType,
  type RuntimeMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'

type NativeMessageArguments = readonly [
  extensionId: string,
  message: RuntimeMessage,
  callback: (response?: ChromeExtensionRuntimeResponse) => void,
]

class ExtensionChannelDiagnosticFixture {
  readonly warn = vi.fn()
  readonly sendMessage = vi.fn<(...request: NativeMessageArguments) => void>()
  readonly channel = new ExtensionMessageChannel(globalThis)

  constructor() {
    const logger: ScopedLogger = {
      error: vi.fn(),
      warn: this.warn,
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      infoWithContext: vi.fn(),
      warnWithContext: vi.fn(),
    }
    vi.spyOn(browserLogRuntime, 'createLogger').mockReturnValue(logger)
  }

  send(): void {
    const request: ExtensionMessageRequest = {
      extensionId: 'diagnostic-extension',
      message: {
        type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
        payload: {
          requestId: 'private-request-marker',
          vaultStoreId: 'private-vault-marker',
        },
      },
      responseWait: {
        kind: ExtensionMessageResponseWaitKind.Bounded,
        timeoutMs: 5_000,
      },
    }
    void this.channel.send(request)
  }

  assertCategory(category: string): void {
    expect(this.warn).toHaveBeenCalledExactlyOnceWith(category)
    expect(JSON.stringify(this.warn.mock.calls)).not.toContain('private-')
    expect(browserLogRuntime.createLogger).toHaveBeenCalledWith(
      'extension-message-channel',
    )
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('extension message delivery diagnostics', () => {
  test('records an absent browser runtime without request data', () => {
    const fixture = new ExtensionChannelDiagnosticFixture()
    const chromeHost = { runtime: { id: 'diagnostic-extension' } }
    vi.stubGlobal('chrome', chromeHost)
    fixture.send()
    fixture.assertCategory('extension message delivery: runtime absent')
  })

  test('records native failure without native error text or request data', () => {
    const fixture = new ExtensionChannelDiagnosticFixture()
    const chromeHost = {
      runtime: {
        sendMessage: fixture.sendMessage,
        lastError: { message: 'private-native-error-marker' },
      },
    }
    vi.stubGlobal('chrome', chromeHost)
    fixture.sendMessage.mockImplementation(
      (...request: NativeMessageArguments) => {
        request[2]()
      },
    )
    fixture.send()
    fixture.assertCategory('extension message delivery: native lastError')
  })

  test('records an absent response without request data', () => {
    const fixture = new ExtensionChannelDiagnosticFixture()
    const chromeHost = { runtime: { sendMessage: fixture.sendMessage } }
    vi.stubGlobal('chrome', chromeHost)
    fixture.sendMessage.mockImplementation(
      (...request: NativeMessageArguments) => {
        request[2]()
      },
    )
    fixture.send()
    fixture.assertCategory('extension message delivery: response absent')
  })

  test('records the current bounded expiry without request data', () => {
    vi.useFakeTimers()
    const fixture = new ExtensionChannelDiagnosticFixture()
    const chromeHost = { runtime: { sendMessage: fixture.sendMessage } }
    vi.stubGlobal('chrome', chromeHost)
    fixture.send()
    vi.advanceTimersByTime(5_000)
    fixture.assertCategory('extension message delivery: bounded expiry')
  })

  test('does not record failure after a successful response', () => {
    vi.useFakeTimers()
    const fixture = new ExtensionChannelDiagnosticFixture()
    const chromeHost = { runtime: { sendMessage: fixture.sendMessage } }
    vi.stubGlobal('chrome', chromeHost)
    fixture.sendMessage.mockImplementation(
      (...request: NativeMessageArguments) => {
        const response: ChromeExtensionRuntimeResponse = { ok: true }
        request[2](response)
      },
    )
    fixture.send()
    vi.advanceTimersByTime(5_000)
    expect(fixture.warn).not.toHaveBeenCalled()
  })
})
