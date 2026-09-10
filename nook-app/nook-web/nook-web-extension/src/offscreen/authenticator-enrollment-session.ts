import { err, ok } from 'neverthrow'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import {
  current_code_from_otpauth_uri,
  preview_otpauth_uri,
  type NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type initNookWasm from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from './session-message-dispatch'
import type { ExtensionSessionRequest } from './session-request-adapter'
import {
  type ExtensionVaultGrant,
  flushPasskeyEventToProviders,
  openPasskeyVault,
} from './session-vault-operations'
import type { ExtensionVaultGrantPayload } from './session-vault-grant'

type AuthenticatorEnrollmentMessage = Extract<
  ExtensionSessionRequest,
  {
    type:
      | ExtensionSessionMessageType.AuthenticatorEnrollPreview
      | ExtensionSessionMessageType.AuthenticatorEnrollCode
      | ExtensionSessionMessageType.AuthenticatorEnrollConfirm
      | ExtensionSessionMessageType.AuthenticatorBackupAttach
  }
>

type AuthenticatorEnrollmentSessionDependencies = {
  ensureWasm: () => ReturnType<typeof initNookWasm>
  getManager: () => Promise<NookVaultManager>
  extensionVaultGrant: (
    payload: ExtensionVaultGrantPayload,
  ) => ExtensionVaultGrant
}

type AuthenticatorEnrollmentMessageHandlingRequest = {
  message: AuthenticatorEnrollmentMessage
  dependencies: AuthenticatorEnrollmentSessionDependencies
}

export async function handleAuthenticatorEnrollmentMessage({
  message,
  dependencies,
}: AuthenticatorEnrollmentMessageHandlingRequest) {
  try {
    switch (message.type) {
      case ExtensionSessionMessageType.AuthenticatorEnrollPreview: {
        const payload = message.payload
        if (typeof payload.otpauthUri !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        await dependencies.ensureWasm()
        const preview = preview_otpauth_uri(payload.otpauthUri)
        try {
          return ok({
            ok: true,
            preview: {
              issuer: preview.issuer,
              account: preview.account,
              websiteUrl: preview.websiteUrl,
              algorithm: preview.algorithm,
              digits: preview.digits,
              period: preview.period,
            },
          })
        } finally {
          preview.free()
        }
      }
      case ExtensionSessionMessageType.AuthenticatorEnrollCode: {
        const payload = message.payload
        if (typeof payload.otpauthUri !== 'string') {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        await dependencies.ensureWasm()
        const code = current_code_from_otpauth_uri(payload.otpauthUri)
        try {
          return ok({
            ok: true,
            code: code.code,
            expiresAt: code.expiresAtUnixSeconds * 1_000,
          })
        } finally {
          code.free()
        }
      }
      case ExtensionSessionMessageType.AuthenticatorEnrollConfirm: {
        const payload = message.payload
        const grant = dependencies.extensionVaultGrant(payload)
        if (
          typeof payload.otpauthUri !== 'string' ||
          typeof payload.origin !== 'string'
        ) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const activeManager = await dependencies.getManager()
        const openArgs: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        const admission0 = await openPasskeyVault(openArgs)
        if (admission0.isErr()) return err(admission0.error)
        const secretId = await activeManager.add_authenticator_from_otpauth_js(
          payload.otpauthUri,
          payload.origin,
        )
        const flushArgs: Parameters<typeof flushPasskeyEventToProviders>[0] = {
          activeManager,
          vaultStoreId: grant.vaultStoreId,
        }
        const admission1 = await flushPasskeyEventToProviders(flushArgs)
        if (admission1.isErr()) return err(admission1.error)
        return ok({ ok: true, secretId })
      }
      case ExtensionSessionMessageType.AuthenticatorBackupAttach: {
        const payload = message.payload
        const grant = dependencies.extensionVaultGrant(payload)
        if (
          typeof payload.secretId !== 'string' ||
          typeof payload.mode !== 'string' ||
          !Array.isArray(payload.codes) ||
          !payload.codes.every((code) => typeof code === 'string')
        ) {
          return err(
            new SessionOperationFailure(
              SessionOperationFailureKind.InvalidRequest,
            ),
          )
        }
        const activeManager = await dependencies.getManager()
        const openArgs: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        const admission2 = await openPasskeyVault(openArgs)
        if (admission2.isErr()) return err(admission2.error)
        const attachResult =
          await activeManager.attach_authenticator_backup_codes_js(
            payload.secretId,
            payload.codes,
            payload.mode,
          )
        try {
          if (!attachResult.backupCodesVerified) {
            return err(
              new SessionOperationFailure(
                SessionOperationFailureKind.Verification,
              ),
            )
          }
          if (!attachResult.reviewed_input_persisted) {
            return err(
              new SessionOperationFailure(
                SessionOperationFailureKind.Verification,
              ),
            )
          }
          const flushArgs: Parameters<typeof flushPasskeyEventToProviders>[0] =
            {
              activeManager,
              vaultStoreId: grant.vaultStoreId,
            }
          const admission3 = await flushPasskeyEventToProviders(flushArgs)
          if (admission3.isErr()) return err(admission3.error)
          return ok({
            ok: true,
            secretId: attachResult.secretId,
            backupCodesVerified: true,
            reviewedInputPersisted: true,
          })
        } finally {
          attachResult.free()
        }
      }
    }
  } catch {
    return err(new SessionOperationFailure(SessionOperationFailureKind.Failed))
  }
}
