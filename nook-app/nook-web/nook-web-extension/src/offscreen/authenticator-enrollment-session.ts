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
      | typeof ExtensionSessionMessageType.AuthenticatorEnrollPreview
      | typeof ExtensionSessionMessageType.AuthenticatorEnrollCode
      | typeof ExtensionSessionMessageType.AuthenticatorEnrollConfirm
      | typeof ExtensionSessionMessageType.AuthenticatorBackupAttach
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

type AuthenticatorEnrollmentPreviewResponse = {
  readonly ok: true
  readonly preview: {
    readonly issuer: string
    readonly account: string
    readonly websiteUrl: string
    readonly algorithm: string
    readonly digits: number
    readonly period: number
  }
}

type AuthenticatorEnrollmentCodeResponse = {
  readonly ok: true
  readonly code: string
  readonly expiresAt: number
}

type AuthenticatorEnrollmentConfirmationResponse = {
  readonly ok: true
  readonly secretId: string
}

type AuthenticatorBackupAttachmentResponse = {
  readonly ok: true
  readonly secretId: string
  readonly backupCodesVerified: true
  readonly reviewedInputPersisted: true
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
          const response: AuthenticatorEnrollmentPreviewResponse = {
            ok: true,
            preview: {
              issuer: preview.issuer,
              account: preview.account,
              websiteUrl: preview.websiteUrl,
              algorithm: preview.algorithm,
              digits: preview.digits,
              period: preview.period,
            },
          }
          return ok(response)
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
          const response: AuthenticatorEnrollmentCodeResponse = {
            ok: true,
            code: code.code,
            expiresAt: code.expiresAtUnixSeconds * 1_000,
          }
          return ok(response)
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
        const response: AuthenticatorEnrollmentConfirmationResponse = {
          ok: true,
          secretId,
        }
        return ok(response)
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
          const response: AuthenticatorBackupAttachmentResponse = {
            ok: true,
            secretId: attachResult.secretId,
            backupCodesVerified: true,
            reviewedInputPersisted: true,
          }
          return ok(response)
        } finally {
          attachResult.free()
        }
      }
    }
  } catch {
    return err(new SessionOperationFailure(SessionOperationFailureKind.Failed))
  }
}
