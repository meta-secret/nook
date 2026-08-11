import { describe, expect, test } from 'bun:test'
import type { ExtensionSessionTransportRequest } from '../src/offscreen/session-request-adapter'
import type { attachAuthenticatorBackupCodes } from '../src/background/service-worker/authenticator-session-adapter'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { WebsiteAuthenticatorBackupAttachMessageMode } from '../src/lib/enrollment-messages'
import { ExtensionPairingVaultType } from '../../nook-web-shared/src/extension/runtime-messages'

function pairingGrant(): Parameters<
  typeof attachAuthenticatorBackupCodes
>[0]['grant'] {
  return {
    vaultType: ExtensionPairingVaultType.Simple,
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
    const runtime = {
      sendMessage: (
        ...parameters: [
          ExtensionSessionTransportRequest,
          (response: unknown) => void,
        ]
      ) => {
        const [message, callback] = parameters
        queueMicrotask(() => {
          if (
            message.type ===
            ExtensionSessionMessageType.AuthenticatorBackupAttach
          ) {
            observedCodes.push([...message.payload.codes])
          }
          callback({ ok: true, secretId: 'secret-1' })
        })
      },
    }
    globalThis.chrome = { runtime } as typeof chrome
    const { attachAuthenticatorBackupCodes } =
      await import('../src/background/service-worker/authenticator-session-adapter')
    const codes = ['A1B2-C3D4', 'E5F6-G7H8']
    const args: Parameters<typeof attachAuthenticatorBackupCodes>[0] = {
      grant: pairingGrant(),
      secretId: 'secret-1',
      codes,
      mode: WebsiteAuthenticatorBackupAttachMessageMode.Replace,
    }

    const pending = attachAuthenticatorBackupCodes(args)
    codes.fill('')

    await expect(pending).resolves.toEqual({ ok: true, secretId: 'secret-1' })
    expect(observedCodes).toEqual([['A1B2-C3D4', 'E5F6-G7H8']])
  })
})
