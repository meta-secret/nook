import { describe, expect, test } from 'bun:test'
import type { NookVaultManager } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionPairingVaultType } from '../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import {
  authorizeAuthenticatorEnrollment,
  handleAuthenticatorEnrollmentMessage,
  revokeAuthenticatorEnrollment,
} from '../src/offscreen/authenticator-enrollment-session'

enum DeferredStateKind {
  Waiting = 'waiting',
  Releasable = 'releasable',
}

type DeferredState =
  | { kind: DeferredStateKind.Waiting }
  | { kind: DeferredStateKind.Releasable; release: () => void }

function deferred() {
  let state: DeferredState = { kind: DeferredStateKind.Waiting }
  const promise = new Promise<void>((resolve) => {
    state = { kind: DeferredStateKind.Releasable, release: resolve }
  })
  return {
    promise,
    release: () => {
      if (state.kind === DeferredStateKind.Releasable) state.release()
    },
  }
}

describe('authenticator enrollment cancellation', () => {
  test('dismissal before commit prevents authenticator persistence', async () => {
    const authorizationId = 'stage-dismissed-before-commit'
    const vaultOpenStarted = deferred()
    const allowVaultOpen = deferred()
    let persistenceCount = 0
    const manager = {
      open_extension_passkey_vault_js: async () => {
        vaultOpenStarted.release()
        await allowVaultOpen.promise
      },
      add_authenticator_from_otpauth_js: async () => {
        persistenceCount += 1
        return 'secret-1'
      },
    } as NookVaultManager
    const message = {
      type: ExtensionSessionMessageType.AuthenticatorEnrollConfirm,
      payload: {
        vaultStoreId: 'vault-1',
        deviceId: 'device-1',
        devicePublicKey: 'device-public-key',
        deviceSigningPublicKey: 'device-signing-public-key',
        otpauthUri:
          'otpauth://totp/Nook:test?secret=JBSWY3DPEHPK3PXP&issuer=Nook',
        origin: 'https://example.test',
        enrollmentAuthorizationId: authorizationId,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    } as Parameters<typeof handleAuthenticatorEnrollmentMessage>[0]['message']

    expect(
      authorizeAuthenticatorEnrollment({
        enrollmentAuthorizationId: authorizationId,
        expiresAt: Date.now() + 5_000,
      }),
    ).toBe(true)
    const confirmation = handleAuthenticatorEnrollmentMessage({
      message,
      dependencies: {
        ensureWasm: () => Promise.resolve(),
        getManager: () => Promise.resolve(manager),
        extensionVaultGrant: () => ({
          vaultType: ExtensionPairingVaultType.Simple,
          vaultStoreId: 'vault-1',
          deviceId: 'device-1',
          devicePublicKey: 'device-public-key',
          deviceSigningPublicKey: 'device-signing-public-key',
        }),
      },
    })

    await vaultOpenStarted.promise
    expect(revokeAuthenticatorEnrollment(authorizationId)).toBe(true)
    allowVaultOpen.release()

    await expect(confirmation).rejects.toThrow(
      'Extension session enrollment authorization expired.',
    )
    expect(persistenceCount).toBe(0)
  })
})
