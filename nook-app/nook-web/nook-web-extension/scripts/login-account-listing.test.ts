import { err, ok } from 'neverthrow'
import {
  type DecodedExtensionSessionTransportDelivery,
  type ExtensionSessionTransport,
  type ExtensionSessionTransportDelivery,
  type ExtensionSessionTransportResult,
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'
import { describe, expect, mock, test } from 'bun:test'
import { Effect } from 'effect'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import type { WebsiteLoginAccountOption } from '../src/lib/login-fill-messages'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import { extensionSessionProbeDeadline } from '../src/offscreen/session-request-adapter'
import type { ExtensionSessionTransportRequest } from '../src/offscreen/session-request-adapter'
import type { ExtensionSessionResponse } from '../src/offscreen/session'

type QueuedSessionTransportFixtureArgs = {
  deliveries: ExtensionSessionTransportResult<ExtensionSessionResponse>[]
}
type SimpleVaultUrlFixtureConfiguration = {
  readonly __NOOK_SIMPLE_VAULT_URL__: string
}

class QueuedSessionTransportFixture implements ExtensionSessionTransport {
  deliveryCount = 0
  readonly messages: ExtensionSessionTransportRequest[] = []

  constructor(private readonly args: QueuedSessionTransportFixtureArgs) {}

  sendMessage(
    delivery: ExtensionSessionTransportDelivery,
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendMessage<Response, DecodeFailure>(
    delivery: DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  async sendMessage<Response = ExtensionSessionResponse, DecodeFailure = never>(
    delivery:
      | ExtensionSessionTransportDelivery
      | DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
  ): Promise<
    | ExtensionSessionTransportResult<ExtensionSessionResponse>
    | ExtensionSessionTransportResult<Response, DecodeFailure>
  > {
    this.deliveryCount += 1
    this.messages.push(delivery.message)
    const queuedDelivery = this.args.deliveries.shift()
    if (!queuedDelivery)
      throw new Error('login account fixture delivery exhausted')
    if (queuedDelivery.isErr())
      return err<Response, ExtensionSessionTransportFailure | DecodeFailure>(
        queuedDelivery.error,
      )
    if (!('decodeResponse' in delivery)) return queuedDelivery
    const decoded = delivery.decodeResponse(queuedDelivery.value)
    return decoded.match(
      (value) =>
        ok<Response, ExtensionSessionTransportFailure | DecodeFailure>(value),
      (failure) =>
        err<Response, ExtensionSessionTransportFailure | DecodeFailure>(
          failure,
        ),
    )
  }
}

function grant(vaultStoreId: string): StoredExtensionPairingGrant {
  return {
    vaultType: 'simple',
    vaultStoreId,
    vaultName: vaultStoreId,
    deviceId: `${vaultStoreId}-device`,
    devicePublicKey: `${vaultStoreId}-public`,
    deviceSigningPublicKey: `${vaultStoreId}-signing`,
    deviceLabel: `${vaultStoreId}-device`,
    approvedAt: 1_786_320_000_000,
    scopes: [],
    syncProviderCount: 0,
    eventCount: 0,
    eventLogHeads: [],
    lastLocalSyncAt: '',
  }
}

type VkLoginAccountListingContext = {
  readonly self: VkLoginAccountListingScenario
}

class VkLoginAccountListingScenario {
  private readonly generatorContext: VkLoginAccountListingContext = {
    self: this,
  }
  private readonly transport: QueuedSessionTransportFixture

  constructor() {
    // Rust owns host matching; this fixture verifies its account projection reaches the picker.
    const response: ExtensionSessionResponse = {
      ok: true,
      accounts: [
        {
          secretId: 'vk-login',
          username: 'vk-fixture-user',
          websiteUrl: 'https://vk.ru/',
          websiteHost: 'vk.ru',
        },
      ],
    }
    const configuration: QueuedSessionTransportFixtureArgs = {
      deliveries: [ok(response)],
    }
    this.transport = new QueuedSessionTransportFixture(configuration)
  }

  readonly verifyProjection = Effect.fn(this.generatorContext, function* () {
    const configuration: SimpleVaultUrlFixtureConfiguration = {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    }
    Object.assign(globalThis, configuration)
    const { accountPickerSessions } = yield* Effect.tryPromise(
      () => import('../src/background/service-worker/account-pickers'),
    )
    const request: Parameters<
      typeof accountPickerSessions.loginAccountsForOrigin
    >[0] = {
      grants: [grant('vk-vault')],
      origin: 'https://id.vk.ru',
      sendMessage: (message) => {
        const delivery: ExtensionSessionTransportDelivery = { message }
        return this.transport.sendMessage(delivery)
      },
    }
    const accounts = yield* Effect.tryPromise(() =>
      accountPickerSessions.loginAccountsForOrigin(request),
    )
    const expected: WebsiteLoginAccountOption[] = [
      {
        vaultStoreId: 'vk-vault',
        vaultName: 'vk-vault',
        secretId: 'vk-login',
        username: 'vk-fixture-user',
        websiteUrl: 'https://vk.ru/',
        websiteHost: 'vk.ru',
      },
    ]
    expect(accounts).toEqual(expected)
    expect(this.transport.messages).toHaveLength(1)
    expect(this.transport.messages[0]?.type).toBe(
      ExtensionSessionMessageType.ListLogins,
    )
    expect(this.transport.messages[0]?.payload).toHaveProperty(
      'origin',
      'https://id.vk.ru',
    )
  })
}

describe('login account listing failure handling', () => {
  test('forwards the VK password-step origin and retains the typed saved account', () => {
    const scenario = new VkLoginAccountListingScenario()
    return Effect.runPromise(scenario.verifyProjection())
  })

  test('skips a failed grant interactively but fails the passive aggregate closed', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { accountPickerSessions } =
      await import('../src/background/service-worker/account-pickers')
    const grants = [grant('failed-vault'), grant('healthy-vault')]
    const interactiveTransport = new QueuedSessionTransportFixture({
      deliveries: [
        err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ),
        ),
        ok({
          ok: true,
          accounts: [
            {
              secretId: 'login-1',
              username: 'person@example.test',
              websiteUrl: 'https://example.test/login',
              websiteHost: 'example.test',
            },
          ],
        }),
      ],
    })
    const interactiveRequest: Parameters<
      typeof accountPickerSessions.loginAccountsForOrigin
    >[0] = {
      grants,
      origin: 'https://example.test',
      sendMessage: (message: ExtensionSessionTransportRequest) =>
        interactiveTransport.sendMessage({ message }),
    }
    expect(
      await accountPickerSessions.loginAccountsForOrigin(interactiveRequest),
    ).toEqual([
      {
        vaultStoreId: 'healthy-vault',
        vaultName: 'healthy-vault',
        secretId: 'login-1',
        username: 'person@example.test',
        websiteUrl: 'https://example.test/login',
        websiteHost: 'example.test',
      },
    ])
    expect(interactiveTransport.deliveryCount).toBe(2)

    const unavailableTransport = new QueuedSessionTransportFixture({
      deliveries: [
        err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ),
        ),
        err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ),
        ),
      ],
    })
    const unavailableRequest: Parameters<
      typeof accountPickerSessions.loginAccountsForOrigin
    >[0] = {
      grants,
      origin: 'https://example.test',
      sendMessage: (message: ExtensionSessionTransportRequest) =>
        unavailableTransport.sendMessage({ message }),
    }
    expect(
      await accountPickerSessions.loginAccountsForOrigin(unavailableRequest),
    ).toEqual([])

    const passiveTransport = new QueuedSessionTransportFixture({
      deliveries: [
        err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ),
        ),
      ],
    })
    const passiveRequest: Parameters<
      typeof accountPickerSessions.loginAccountAvailabilityForOrigin
    >[0] = {
      grants,
      origin: 'https://example.test',
      queue: extensionSessionProbeDeadline(Date.now() + 1_000),
      sendMessage: (message: ExtensionSessionTransportRequest) =>
        passiveTransport.sendMessage({ message }),
    }
    expect(
      await accountPickerSessions.loginAccountAvailabilityForOrigin(
        passiveRequest,
      ),
    ).toEqual({ ok: false })
    expect(passiveTransport.deliveryCount).toBe(1)
  })

  test('isolates rejected grant transports interactively but fails the passive aggregate closed', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { accountPickerSessions } =
      await import('../src/background/service-worker/account-pickers')
    const grants = [grant('failed-vault'), grant('healthy-vault')]
    const interactiveSendMessage = mock()
      .mockResolvedValueOnce(
        err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ),
        ),
      )
      .mockResolvedValueOnce(
        ok({
          ok: true,
          accounts: [
            {
              secretId: 'login-1',
              username: 'person@example.test',
              websiteUrl: 'https://example.test/login',
              websiteHost: 'example.test',
            },
          ],
        }),
      )
    const interactiveRequest: Parameters<
      typeof accountPickerSessions.loginAccountsForOrigin
    >[0] = {
      grants,
      origin: 'https://example.test',
      sendMessage: interactiveSendMessage,
    }
    expect(
      await accountPickerSessions.loginAccountsForOrigin(interactiveRequest),
    ).toEqual([
      {
        vaultStoreId: 'healthy-vault',
        vaultName: 'healthy-vault',
        secretId: 'login-1',
        username: 'person@example.test',
        websiteUrl: 'https://example.test/login',
        websiteHost: 'example.test',
      },
    ])
    expect(interactiveSendMessage).toHaveBeenCalledTimes(2)

    const passiveSendMessage = mock(() =>
      Promise.resolve(
        err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ),
        ),
      ),
    )
    const passiveRequest: Parameters<
      typeof accountPickerSessions.loginAccountAvailabilityForOrigin
    >[0] = {
      grants,
      origin: 'https://example.test',
      queue: extensionSessionProbeDeadline(Date.now() + 1_000),
      sendMessage: passiveSendMessage,
    }
    expect(
      await accountPickerSessions.loginAccountAvailabilityForOrigin(
        passiveRequest,
      ),
    ).toEqual({ ok: false })
    expect(passiveSendMessage).toHaveBeenCalledTimes(1)
  })

  test('fails passive availability closed on malformed account entries', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { accountPickerSessions } =
      await import('../src/background/service-worker/account-pickers')
    const passiveRequest: Parameters<
      typeof accountPickerSessions.loginAccountAvailabilityForOrigin
    >[0] = {
      grants: [grant('malformed-vault')],
      origin: 'https://example.test',
      queue: extensionSessionProbeDeadline(Date.now() + 1_000),
      sendMessage: mock(() => {
        const malformedAccountResponse: ExtensionSessionResponse = { ok: true }
        Object.assign(malformedAccountResponse, {
          accounts: [
            { secretId: 'login-1', issuer: 'issuer', account: 'name' },
          ],
        })
        return Promise.resolve(ok(malformedAccountResponse))
      }),
    }
    expect(
      await accountPickerSessions.loginAccountAvailabilityForOrigin(
        passiveRequest,
      ),
    ).toEqual({ ok: false })
  })
})
