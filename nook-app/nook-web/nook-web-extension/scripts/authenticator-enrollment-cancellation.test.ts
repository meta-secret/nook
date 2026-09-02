import { expect, test } from 'bun:test'
import type { NookVaultManager } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionPairingVaultType } from '../../nook-web-shared/src/extension/runtime-messages'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import { handleAuthenticatorEnrollmentMessage } from '../src/offscreen/authenticator-enrollment-session'
type HandlerArgs = Parameters<typeof handleAuthenticatorEnrollmentMessage>[0]
type EnrollmentMessage = HandlerArgs['message']
const identity = {
  vaultStoreId: 'vault-1',
  deviceId: 'device-1',
  devicePublicKey: 'device-public-key',
  deviceSigningPublicKey: 'device-signing-public-key',
}
const expired = 'Extension session enrollment authorization expired.'
function dependencies(manager: NookVaultManager): HandlerArgs['dependencies'] {
  return {
    ensureWasm: async () => {},
    getManager: async () => manager,
    extensionVaultGrant: () => ({
      vaultType: ExtensionPairingVaultType.Simple,
      ...identity,
    }),
  }
}
function dispatch(message: EnrollmentMessage, manager: NookVaultManager) {
  const args: HandlerArgs = { message, dependencies: dependencies(manager) }
  return handleAuthenticatorEnrollmentMessage(args)
}
function confirmationMessage(id: string): EnrollmentMessage {
  return {
    type: ExtensionSessionMessageType.AuthenticatorEnrollConfirm,
    payload: {
      ...identity,
      otpauthUri:
        'otpauth://totp/Nook:test?secret=JBSWY3DPEHPK3PXP&issuer=Nook',
      origin: 'https://example.test',
      enrollmentAuthorizationId: id,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
}
async function authorize(id: string): Promise<boolean> {
  const expiresAt = Date.now() + 5_000
  const message: EnrollmentMessage = {
    type: ExtensionSessionMessageType.AuthenticatorEnrollAuthorize,
    payload: {
      enrollmentAuthorizationId: id,
      expiresAt,
      queue: { kind: 'deadline', expiresAt, priority: 'interactive' },
    },
  }
  return (await dispatch(message, {} as NookVaultManager)).accepted === true
}
async function revoke(id: string): Promise<boolean> {
  const message: EnrollmentMessage = {
    type: ExtensionSessionMessageType.AuthenticatorEnrollRevoke,
    payload: {
      enrollmentAuthorizationId: id,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  return (await dispatch(message, {} as NookVaultManager)).accepted === true
}
test('enrollment dismissal before commit prevents persistence', async () => {
  const authorizationId = 'stage-dismissed-before-commit'
  const vaultOpenStarted = Promise.withResolvers<void>()
  const allowVaultOpen = Promise.withResolvers<void>()
  let persistenceCount = 0
  const manager = {
    open_extension_passkey_vault_js: async () => {
      vaultOpenStarted.resolve()
      await allowVaultOpen.promise
    },
    add_authenticator_from_otpauth_js: async () => {
      persistenceCount += 1
      return 'secret-1'
    },
  } as NookVaultManager
  expect(await authorize(authorizationId)).toBe(true)
  const confirmation = dispatch(confirmationMessage(authorizationId), manager)
  await vaultOpenStarted.promise
  expect(await revoke(authorizationId)).toBe(true)
  allowVaultOpen.resolve()
  await expect(confirmation).rejects.toThrow(expired)
  expect(persistenceCount).toBe(0)
})
test('enrollment dismissal during and after commit is rejected', async () => {
  const authorizationId = 'stage-commit-claimed'
  const persistenceStarted = Promise.withResolvers<void>()
  const allowPersistence = Promise.withResolvers<void>()
  const manager = {
    open_extension_passkey_vault_js: async () => {},
    add_authenticator_from_otpauth_js: async () => {
      persistenceStarted.resolve()
      await allowPersistence.promise
      return 'secret-1'
    },
    load_auth_providers_snapshot: async () => ({ providers: [] }),
  } as NookVaultManager
  expect(await authorize(authorizationId)).toBe(true)
  const confirmation = dispatch(confirmationMessage(authorizationId), manager)
  await persistenceStarted.promise
  expect(await revoke(authorizationId)).toBe(false)
  allowPersistence.resolve()
  await expect(confirmation).resolves.toEqual({
    ok: true,
    secretId: 'secret-1',
  })
  expect(await revoke(authorizationId)).toBe(false)
})
test('enrollment lost offscreen authorization fails closed', async () => {
  let persistenceCount = 0
  const manager = {
    open_extension_passkey_vault_js: async () => {},
    add_authenticator_from_otpauth_js: async () => {
      persistenceCount += 1
      return 'secret-1'
    },
  } as NookVaultManager
  const id = 'stage-lost-offscreen-state'
  await expect(dispatch(confirmationMessage(id), manager)).rejects.toThrow(
    expired,
  )
  expect(persistenceCount).toBe(0)
  expect(await revoke(id)).toBe(false)
})
