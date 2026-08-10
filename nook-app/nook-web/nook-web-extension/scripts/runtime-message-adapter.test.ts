import { describe, expect, test } from 'bun:test'
import { AuthenticationOutcomeVerdict } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  RuntimeMessageDeliveryKind,
  sendAuthenticationOutcomeRuntimeMessage,
  sendDecodedRuntimeMessage,
  sendLoginOptionsRuntimeMessage,
  sendLoginPickerOpenRuntimeMessage,
} from '../src/content/autofill/runtime-message-adapter'

type TestAcknowledgement = { accepted: true }

function isTestAcknowledgement(
  response: object,
): response is TestAcknowledgement {
  return 'accepted' in response && response.accepted === true
}

enum RuntimeMockKind {
  Response = 'response',
  LastError = 'last-error',
}

type RuntimeMock =
  | { kind: RuntimeMockKind.Response; response: object }
  | { kind: RuntimeMockKind.LastError }

function installRuntimeMock(mock: RuntimeMock): void {
  const runtime = {
    sendMessage: (...parameters: [object, (response: object) => void]) => {
      const callback = parameters[1]
      const response =
        mock.kind === RuntimeMockKind.Response ? mock.response : {}
      callback(response)
    },
  }
  if (mock.kind === RuntimeMockKind.LastError) {
    const lastErrorDescriptor: PropertyDescriptor = {
      value: { message: 'extension context unavailable' },
    }
    Object.defineProperty(runtime, 'lastError', lastErrorDescriptor)
  }
  globalThis.chrome = { runtime } as typeof chrome
}

const message = { type: 'test:runtime-adapter' }

describe('runtime message adapters', () => {
  test('initializes companion WASM before decoding a valid login options wire', async () => {
    const response = {
      ok: true,
      status: 'ready',
      accounts: [
        {
          vaultStoreId: 'vault-1',
          vaultName: 'Personal',
          secretId: 'secret-1',
          username: 'person@example.test',
          websiteUrl: 'https://example.test/login',
          websiteHost: 'example.test',
        },
      ],
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginOptionsRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe('ready')
    }
  })

  test('rejects malformed login options in Rust', async () => {
    const response = { ok: true, status: 'ready' }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginOptionsRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('decodes a valid login picker response in Rust', async () => {
    const response = {
      ok: true,
      status: 'ready',
      requestId: 'request-1',
      expiresAt: 12_345,
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginPickerOpenRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
    if (delivery.kind === RuntimeMessageDeliveryKind.Delivered) {
      expect(delivery.response.kind).toBe('ready')
    }
  })

  test('rejects malformed login picker responses in Rust', async () => {
    const response = {
      ok: true,
      status: 'locked',
      requestId: 'unexpected',
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendLoginPickerOpenRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('reports Chrome runtime failures as unavailable', async () => {
    installRuntimeMock({ kind: RuntimeMockKind.LastError })

    const delivery = await sendLoginOptionsRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('delivers only responses accepted by a concrete decoder', async () => {
    const response = { accepted: true }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })
    const sendArgs: Parameters<
      typeof sendDecodedRuntimeMessage<TestAcknowledgement>
    >[0] = {
      message,
      decode: isTestAcknowledgement,
    }

    const delivery =
      await sendDecodedRuntimeMessage<TestAcknowledgement>(sendArgs)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
  })

  test('rejects a response refused by its concrete decoder', async () => {
    const response = { accepted: false }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })
    const sendArgs: Parameters<
      typeof sendDecodedRuntimeMessage<TestAcknowledgement>
    >[0] = {
      message,
      decode: isTestAcknowledgement,
    }

    const delivery =
      await sendDecodedRuntimeMessage<TestAcknowledgement>(sendArgs)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('rejects an outcome decision that contradicts its Rust verdict', async () => {
    const response = {
      ok: true,
      verdict: {
        verdict: AuthenticationOutcomeVerdict.Insufficient,
        allowsCredentialCommit: true,
      },
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticationOutcomeRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Unavailable)
  })

  test('accepts a consistent outcome decision through Rust', async () => {
    const response = {
      ok: true,
      verdict: {
        verdict: AuthenticationOutcomeVerdict.Sufficient,
        allowsCredentialCommit: true,
      },
    }
    installRuntimeMock({ kind: RuntimeMockKind.Response, response })

    const delivery = await sendAuthenticationOutcomeRuntimeMessage(message)

    expect(delivery.kind).toBe(RuntimeMessageDeliveryKind.Delivered)
  })
})
