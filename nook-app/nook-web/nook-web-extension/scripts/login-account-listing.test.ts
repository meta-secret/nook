import { err, ok, type Result } from 'neverthrow'
import {
  type ExtensionSessionTransport,
  type ExtensionSessionTransportResult,
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'
import { describe, expect, mock, test } from 'bun:test'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import { extensionSessionProbeDeadline } from '../src/offscreen/session-request-adapter'
import type { ExtensionSessionTransportRequest } from '../src/offscreen/session-request-adapter'
import type { ExtensionSessionResponse } from '../src/offscreen/session'

type QueuedSessionTransportFixtureArgs = {
  deliveries: ExtensionSessionTransportResult<ExtensionSessionResponse>[]
}

class QueuedSessionTransportFixture implements ExtensionSessionTransport {
  deliveryCount = 0

  constructor(private readonly args: QueuedSessionTransportFixtureArgs) {}

  sendMessage(
    message: ExtensionSessionTransportRequest,
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendMessage<Response, DecodeFailure>(
    message: ExtensionSessionTransportRequest,
    decodeResponse: (
      response: ExtensionSessionResponse,
    ) => Result<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  async sendMessage<Response = ExtensionSessionResponse, DecodeFailure = never>(
    _message: ExtensionSessionTransportRequest,
    decodeResponse?: (
      response: ExtensionSessionResponse,
    ) => Result<Response, DecodeFailure>,
  ): Promise<
    | ExtensionSessionTransportResult<ExtensionSessionResponse>
    | ExtensionSessionTransportResult<Response, DecodeFailure>
  > {
    this.deliveryCount += 1
    const delivery = this.args.deliveries.shift()
    if (!delivery) throw new Error('login account fixture delivery exhausted')
    if (delivery.isErr())
      return err<Response, ExtensionSessionTransportFailure | DecodeFailure>(
        delivery.error,
      )
    if (!decodeResponse) return delivery
    return decodeResponse(delivery.value).mapErr((failure) => failure)
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

describe('login account listing failure handling', () => {
  test('skips a failed grant interactively but fails the passive aggregate closed', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { accountPickerSessions } =
      await import('../src/background/service-worker/account-pickers')
    const grants = [grant('failed-vault'), grant('healthy-vault')]
    const interactiveTransport = new QueuedSessionTransportFixture({
      deliveries: [
        ok({ ok: false, reason: 'session-list-failed' }),
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
      sendMessage: interactiveTransport.sendMessage.bind(interactiveTransport),
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
      ],
    })
    const unavailableRequest: Parameters<
      typeof accountPickerSessions.loginAccountsForOrigin
    >[0] = {
      grants,
      origin: 'https://example.test',
      sendMessage: unavailableTransport.sendMessage.bind(unavailableTransport),
    }
    expect(
      await accountPickerSessions.loginAccountsForOrigin(unavailableRequest),
    ).toEqual([])

    const passiveTransport = new QueuedSessionTransportFixture({
      deliveries: [ok({ ok: false, reason: 'session-list-failed' })],
    })
    const passiveRequest: Parameters<
      typeof accountPickerSessions.loginAccountAvailabilityForOrigin
    >[0] = {
      grants,
      origin: 'https://example.test',
      queue: extensionSessionProbeDeadline(Date.now() + 1_000),
      sendMessage: passiveTransport.sendMessage.bind(passiveTransport),
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
      sendMessage: mock(() =>
        Promise.resolve(
          ok({
            ok: true,
            accounts: [{ secretId: 'login-1' }],
          }),
        ),
      ),
    }
    expect(
      await accountPickerSessions.loginAccountAvailabilityForOrigin(
        passiveRequest,
      ),
    ).toEqual({ ok: false })
  })
})
