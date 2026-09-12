import { err, ok } from 'neverthrow'
import { describe, expect, test } from 'bun:test'
import type { ExtensionSessionTransportRequest } from '../src/offscreen/session-request-adapter'
import type { extensionAuthenticatorSession } from '../src/background/service-worker/authenticator-session-adapter'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { WebsiteAuthenticatorBackupAttachMessageMode } from '../src/lib/enrollment-messages'

function pairingGrant(): Parameters<
  typeof extensionAuthenticatorSession.attachAuthenticatorBackupCodesFromSession
>[0]['grant'] {
  return {
    vaultType: 'simple',
    deviceId: 'device-1',
    devicePublicKey: 'device-public-key',
    deviceSigningPublicKey: 'device-signing-public-key',
    deviceLabel: 'Test browser',
    vaultStoreId: 'vault-1',
    vaultName: 'Test vault',
    approvedAt: '2026-08-11T00:00:00.000Z',
    scopes: [],
    syncProviderCount: 0,
    eventCount: 0,
    eventLogHeads: [],
    lastLocalSyncAt: '2026-08-11T00:00:00.000Z',
  }
}

describe('authenticator session adapter', () => {
  test('owns backup codes until the runtime accepts the message', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const observedCodes: string[][] = []
    const { ExtensionAuthenticatorSession } =
      await import('../src/background/service-worker/authenticator-session-adapter')
    const session = new ExtensionAuthenticatorSession({
      sendSessionMessage: async (request: ExtensionSessionTransportRequest) => {
        if (
          request.type === ExtensionSessionMessageType.AuthenticatorBackupAttach
        ) {
          observedCodes.push([...request.payload.codes])
        }
        return ok({
          ok: true,
          secretId: 'secret-1',
          backupCodesVerified: true,
          reviewedInputPersisted: true,
        })
      },
    })
    const codes = ['A1B2-C3D4', 'E5F6-G7H8']
    const args: Parameters<
      typeof extensionAuthenticatorSession.attachAuthenticatorBackupCodesFromSession
    >[0] = {
      grant: pairingGrant(),
      secretId: 'secret-1',
      codes,
      mode: WebsiteAuthenticatorBackupAttachMessageMode.Replace,
    }

    const pending = session.attachAuthenticatorBackupCodesFromSession(args)
    codes.fill('')

    expect(await pending).toEqual(
      ok({
        ok: true,
        secretId: 'secret-1',
        backupCodesVerified: true,
        reviewedInputPersisted: true,
      }),
    )
    expect(observedCodes).toEqual([['A1B2-C3D4', 'E5F6-G7H8']])
  })

  test('rejects a backup-code response without Rust persistence proof', async () => {
    const {
      ExtensionAuthenticatorSession,
      AuthenticatorSessionFailure,
      AuthenticatorSessionFailureKind,
    } =
      await import('../src/background/service-worker/authenticator-session-adapter')
    const session = new ExtensionAuthenticatorSession({
      sendSessionMessage: async () => ok({ ok: true, secretId: 'secret-1' }),
    })
    const args: Parameters<
      typeof extensionAuthenticatorSession.attachAuthenticatorBackupCodesFromSession
    >[0] = {
      grant: pairingGrant(),
      secretId: 'secret-1',
      codes: ['A1B2-C3D4'],
      mode: WebsiteAuthenticatorBackupAttachMessageMode.Replace,
    }

    expect(
      await session.attachAuthenticatorBackupCodesFromSession(args),
    ).toEqual(
      err(
        new AuthenticatorSessionFailure(
          AuthenticatorSessionFailureKind.InvalidResponse,
        ),
      ),
    )
  })
})
