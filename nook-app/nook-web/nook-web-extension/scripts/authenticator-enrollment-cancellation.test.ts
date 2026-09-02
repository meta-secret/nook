import { describe, expect, test } from 'bun:test'
import type { NookVaultManager } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionPairingVaultType } from '../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import { handleAuthenticatorEnrollmentMessage } from '../src/offscreen/authenticator-enrollment-session'

function deferred() {
  let release = () => {
    throw new Error('deferred operation was not initialized')
  }
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release() }
}

function confirmationMessage(
  enrollmentAuthorizationId: string,
): Parameters<typeof handleAuthenticatorEnrollmentMessage>[0]['message'] {
  return {
    type: ExtensionSessionMessageType.AuthenticatorEnrollConfirm,
    payload: {
      vaultStoreId: 'vault-1',
      deviceId: 'device-1',
      devicePublicKey: 'device-public-key',
      deviceSigningPublicKey: 'device-signing-public-key',
      otpauthUri:
        'otpauth://totp/Nook:test?secret=JBSWY3DPEHPK3PXP&issuer=Nook',
      origin: 'https://example.test',
      enrollmentAuthorizationId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
}

function confirmationDependencies(
  manager: NookVaultManager,
): Parameters<typeof handleAuthenticatorEnrollmentMessage>[0]['dependencies'] {
  return {
    ensureWasm: () => Promise.resolve(),
    getManager: () => Promise.resolve(manager),
    extensionVaultGrant: () => ({
      vaultType: ExtensionPairingVaultType.Simple,
      vaultStoreId: 'vault-1',
      deviceId: 'device-1',
      devicePublicKey: 'device-public-key',
      deviceSigningPublicKey: 'device-signing-public-key',
    }),
  }
}

async function authorizeEnrollment(
  enrollmentAuthorizationId: string,
): Promise<boolean> {
  const expiresAt = Date.now() + 5_000
  const response = await handleAuthenticatorEnrollmentMessage({
    message: {
      type: ExtensionSessionMessageType.AuthenticatorEnrollAuthorize,
      payload: {
        enrollmentAuthorizationId,
        expiresAt,
        queue: {
          kind: 'deadline',
          expiresAt,
          priority: 'interactive',
        },
      },
    },
    dependencies: confirmationDependencies({} as NookVaultManager),
  })
  return response.accepted === true
}

async function revokeEnrollment(
  enrollmentAuthorizationId: string,
): Promise<boolean> {
  const response = await handleAuthenticatorEnrollmentMessage({
    message: {
      type: ExtensionSessionMessageType.AuthenticatorEnrollRevoke,
      payload: {
        enrollmentAuthorizationId,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    },
    dependencies: confirmationDependencies({} as NookVaultManager),
  })
  return response.accepted === true
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
    expect(await authorizeEnrollment(authorizationId)).toBe(true)
    const confirmation = handleAuthenticatorEnrollmentMessage({
      message: confirmationMessage(authorizationId),
      dependencies: confirmationDependencies(manager),
    })

    await vaultOpenStarted.promise
    expect(await revokeEnrollment(authorizationId)).toBe(true)
    allowVaultOpen.release()

    await expect(confirmation).rejects.toThrow(
      'Extension session enrollment authorization expired.',
    )
    expect(persistenceCount).toBe(0)
  })

  test('dismissal during and after commit is rejected', async () => {
    const authorizationId = 'stage-commit-claimed'
    const persistenceStarted = deferred()
    const allowPersistence = deferred()
    const manager = {
      open_extension_passkey_vault_js: async () => {},
      add_authenticator_from_otpauth_js: async () => {
        persistenceStarted.release()
        await allowPersistence.promise
        return 'secret-1'
      },
      load_auth_providers_snapshot: async () => ({ providers: [] }),
    } as NookVaultManager
    expect(await authorizeEnrollment(authorizationId)).toBe(true)

    const confirmation = handleAuthenticatorEnrollmentMessage({
      message: confirmationMessage(authorizationId),
      dependencies: confirmationDependencies(manager),
    })
    await persistenceStarted.promise
    expect(await revokeEnrollment(authorizationId)).toBe(false)
    allowPersistence.release()

    await expect(confirmation).resolves.toEqual({
      ok: true,
      secretId: 'secret-1',
    })
    expect(await revokeEnrollment(authorizationId)).toBe(false)
  })

  test('lost offscreen authorization state fails closed', async () => {
    let persistenceCount = 0
    const manager = {
      open_extension_passkey_vault_js: async () => {},
      add_authenticator_from_otpauth_js: async () => {
        persistenceCount += 1
        return 'secret-1'
      },
    } as NookVaultManager

    await expect(
      handleAuthenticatorEnrollmentMessage({
        message: confirmationMessage('stage-lost-offscreen-state'),
        dependencies: confirmationDependencies(manager),
      }),
    ).rejects.toThrow('Extension session enrollment authorization expired.')
    expect(persistenceCount).toBe(0)
    expect(await revokeEnrollment('stage-lost-offscreen-state')).toBe(false)
  })
})
