import { describe, expect, mock, test } from 'bun:test'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import { extensionSessionProbeDeadline } from '../src/offscreen/session-request-adapter'

function grant(vaultStoreId: string): StoredExtensionPairingGrant {
  return {
    vaultStoreId,
    vaultName: vaultStoreId,
    deviceId: `${vaultStoreId}-device`,
    devicePublicKey: `${vaultStoreId}-public`,
    deviceSigningPublicKey: `${vaultStoreId}-signing`,
  } as StoredExtensionPairingGrant
}

describe('login account listing failure handling', () => {
  test('skips a failed grant interactively but fails the passive aggregate closed', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { loginAccountAvailabilityForOrigin, loginAccountsForOrigin } =
      await import('../src/background/service-worker/account-pickers')
    const grants = [grant('failed-vault'), grant('healthy-vault')]
    const responses = [
      { ok: false, reason: 'session-list-failed' },
      {
        ok: true,
        accounts: [
          {
            secretId: 'login-1',
            username: 'person@example.test',
            websiteUrl: 'https://example.test/login',
            websiteHost: 'example.test',
          },
        ],
      },
    ]
    const interactiveSendMessage = mock(() =>
      Promise.resolve(responses.shift()),
    )
    const interactiveRequest: Parameters<typeof loginAccountsForOrigin>[0] = {
      grants,
      origin: 'https://example.test',
      sendMessage: interactiveSendMessage,
    }
    await expect(loginAccountsForOrigin(interactiveRequest)).resolves.toEqual([
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
      Promise.resolve({ ok: false, reason: 'session-list-failed' }),
    )
    const passiveRequest: Parameters<
      typeof loginAccountAvailabilityForOrigin
    >[0] = {
      grants,
      origin: 'https://example.test',
      queue: extensionSessionProbeDeadline(Date.now() + 1_000),
      sendMessage: passiveSendMessage,
    }
    await expect(
      loginAccountAvailabilityForOrigin(passiveRequest),
    ).resolves.toEqual({ ok: false })
    expect(passiveSendMessage).toHaveBeenCalledTimes(1)
  })
})
