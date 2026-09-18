import { err, ok } from 'neverthrow'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'
import { describe, expect, test } from 'bun:test'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { LocalEventLogUpdateFailure } from '../src/background/service-worker/pairing-import'
import {
  routeDecodedLocalUpdate,
  routedGrant,
} from './service-worker-routing-test-support'

describe('local event-log update routing', () => {
  test('keeps the decoded local-update session usable for a subsequent authenticator request', async () => {
    const delivered: ExtensionSessionMessageType[] = []
    const sendSession: Parameters<typeof routeDecodedLocalUpdate>[0] = async (
      message: Parameters<Parameters<typeof routeDecodedLocalUpdate>[0]>[0],
    ) => {
      if (!message || typeof message !== 'object' || !('type' in message)) {
        throw new Error('expected a typed extension session request')
      }
      if (message.type === ExtensionSessionMessageType.ClassifyGrantAuthority) {
        delivered.push(ExtensionSessionMessageType.ClassifyGrantAuthority)
        return ok({ kind: 'Authorized' as const, grant: routedGrant })
      }
      if (message.type === ExtensionSessionMessageType.UpdateVault) {
        delivered.push(ExtensionSessionMessageType.UpdateVault)
        return ok({ ok: true })
      }
      if (message.type === ExtensionSessionMessageType.AuthenticatorCode) {
        delivered.push(ExtensionSessionMessageType.AuthenticatorCode)
        return ok({
          ok: true,
          code: '012345',
          expiresAt: Date.now() + 30_000,
        })
      }
      return err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.DeliveryFailed,
        ),
      )
    }
    const update = await routeDecodedLocalUpdate(sendSession)

    expect(update.response).toEqual({ ok: true, eventCount: 1 })
    expect(update.closeSession).not.toHaveBeenCalled()
    const { ExtensionAuthenticatorSession } =
      await import('../src/background/service-worker/authenticator-session-adapter')
    const authenticator = new ExtensionAuthenticatorSession({
      sendSessionMessage: sendSession,
    })
    const authenticatorResponse =
      await authenticator.authenticatorCodeFromSession({
        grant: routedGrant,
        secretId: 'authenticator-1',
      })
    expect(authenticatorResponse.isOk()).toBe(true)
    if (authenticatorResponse.isOk()) {
      expect(authenticatorResponse.value.ok).toBe(true)
      expect(authenticatorResponse.value.code).toBe('012345')
      expect(typeof authenticatorResponse.value.expiresAt).toBe('number')
    }
    expect(delivered).toEqual([
      ExtensionSessionMessageType.ClassifyGrantAuthority,
      ExtensionSessionMessageType.UpdateVault,
      ExtensionSessionMessageType.AuthenticatorCode,
    ])
  })

  test.each(['transport failure', 'rejected authority'] as const)(
    'closes the local-update session after %s',
    async (scenario) => {
      const update = await routeDecodedLocalUpdate(async () =>
        scenario === 'transport failure'
          ? err(
              new ExtensionSessionTransportFailure(
                ExtensionSessionTransportFailureKind.DeliveryFailed,
              ),
            )
          : ok({ kind: 'MissingActiveAuthority' as const }),
      )

      expect(update.response).toEqual({
        ok: false,
        reason: LocalEventLogUpdateFailure.EventLogImportFailed,
      })
      expect(update.closeSession).toHaveBeenCalledTimes(1)
    },
  )
})
