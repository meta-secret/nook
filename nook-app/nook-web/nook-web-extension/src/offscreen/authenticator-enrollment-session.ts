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
      | ExtensionSessionMessageType.AuthenticatorEnrollAuthorize
      | ExtensionSessionMessageType.AuthenticatorEnrollRevoke
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

enum EnrollmentAuthorizationState {
  Authorized = 'authorized',
  Committing = 'committing',
  Committed = 'committed',
}

type EnrollmentAuthorization = {
  state: EnrollmentAuthorizationState
  expiresAt: number
  expiryTimer: ReturnType<typeof setTimeout>
}

const enrollmentAuthorizations = new Map<string, EnrollmentAuthorization>()
const MAX_ENROLLMENT_AUTHORIZATION_TTL_MS = 5 * 60 * 1000

type AuthorizeAuthenticatorEnrollmentArgs = {
  enrollmentAuthorizationId: string
  expiresAt: number
}

function authorizeAuthenticatorEnrollment({
  enrollmentAuthorizationId,
  expiresAt,
}: AuthorizeAuthenticatorEnrollmentArgs): boolean {
  const now = Date.now()
  if (
    expiresAt <= now ||
    expiresAt > now + MAX_ENROLLMENT_AUTHORIZATION_TTL_MS ||
    enrollmentAuthorizations.has(enrollmentAuthorizationId)
  ) {
    return false
  }
  const expiryTimer = setTimeout(() => {
    enrollmentAuthorizations.delete(enrollmentAuthorizationId)
  }, expiresAt - now)
  const authorization: EnrollmentAuthorization = {
    state: EnrollmentAuthorizationState.Authorized,
    expiresAt,
    expiryTimer,
  }
  enrollmentAuthorizations.set(enrollmentAuthorizationId, authorization)
  return true
}

function revokeAuthenticatorEnrollment(
  enrollmentAuthorizationId: string,
): boolean {
  const authorization = enrollmentAuthorizations.get(enrollmentAuthorizationId)
  if (
    !authorization ||
    authorization.state !== EnrollmentAuthorizationState.Authorized
  ) {
    return false
  }
  clearTimeout(authorization.expiryTimer)
  enrollmentAuthorizations.delete(enrollmentAuthorizationId)
  return true
}

function claimAuthenticatorEnrollment(
  enrollmentAuthorizationId: string,
): boolean {
  const authorization = enrollmentAuthorizations.get(enrollmentAuthorizationId)
  if (
    !authorization ||
    authorization.state !== EnrollmentAuthorizationState.Authorized ||
    authorization.expiresAt <= Date.now()
  ) {
    failAuthenticatorEnrollment(enrollmentAuthorizationId)
    return false
  }
  authorization.state = EnrollmentAuthorizationState.Committing
  return true
}

function failAuthenticatorEnrollment(enrollmentAuthorizationId: string): void {
  const authorization = enrollmentAuthorizations.get(enrollmentAuthorizationId)
  if (authorization) clearTimeout(authorization.expiryTimer)
  enrollmentAuthorizations.delete(enrollmentAuthorizationId)
}

function commitAuthenticatorEnrollment(
  enrollmentAuthorizationId: string,
): void {
  const authorization = enrollmentAuthorizations.get(enrollmentAuthorizationId)
  if (authorization?.state === EnrollmentAuthorizationState.Committing) {
    authorization.state = EnrollmentAuthorizationState.Committed
  }
}

export async function handleAuthenticatorEnrollmentMessage({
  message,
  dependencies,
}: AuthenticatorEnrollmentMessageHandlingRequest) {
  switch (message.type) {
    case ExtensionSessionMessageType.AuthenticatorEnrollAuthorize: {
      const authorizeArgs: AuthorizeAuthenticatorEnrollmentArgs = {
        enrollmentAuthorizationId: message.payload.enrollmentAuthorizationId,
        expiresAt: message.payload.expiresAt,
      }
      return {
        ok: true,
        accepted: authorizeAuthenticatorEnrollment(authorizeArgs),
      }
    }
    case ExtensionSessionMessageType.AuthenticatorEnrollRevoke:
      return {
        ok: true,
        accepted: revokeAuthenticatorEnrollment(
          message.payload.enrollmentAuthorizationId,
        ),
      }
    case ExtensionSessionMessageType.AuthenticatorEnrollPreview: {
      const payload = message.payload
      if (typeof payload.otpauthUri !== 'string') {
        throw new Error('Extension session received an invalid otpauth URI.')
      }
      await dependencies.ensureWasm()
      const preview = preview_otpauth_uri(payload.otpauthUri)
      try {
        return {
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
      } finally {
        preview.free()
      }
    }
    case ExtensionSessionMessageType.AuthenticatorEnrollCode: {
      const payload = message.payload
      if (typeof payload.otpauthUri !== 'string') {
        throw new Error('Extension session received an invalid otpauth URI.')
      }
      await dependencies.ensureWasm()
      const code = current_code_from_otpauth_uri(payload.otpauthUri)
      try {
        return {
          ok: true,
          code: code.code,
          expiresAt: code.expiresAtUnixSeconds * 1_000,
        }
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
        throw new Error('Extension session received an invalid enrollment.')
      }
      const enrollmentAuthorizationId = payload.enrollmentAuthorizationId
      try {
        const activeManager = await dependencies.getManager()
        const openArgs: Parameters<typeof openPasskeyVault>[0] = {
          activeManager,
          grant,
        }
        await openPasskeyVault(openArgs)
        if (!claimAuthenticatorEnrollment(enrollmentAuthorizationId)) {
          throw new Error('Extension session enrollment authorization expired.')
        }
        const secretId = await activeManager.add_authenticator_from_otpauth_js(
          payload.otpauthUri,
          payload.origin,
        )
        const flushArgs: Parameters<typeof flushPasskeyEventToProviders>[0] = {
          activeManager,
          vaultStoreId: grant.vaultStoreId,
        }
        await flushPasskeyEventToProviders(flushArgs)
        commitAuthenticatorEnrollment(enrollmentAuthorizationId)
        return { ok: true, secretId }
      } catch (error) {
        failAuthenticatorEnrollment(enrollmentAuthorizationId)
        throw error
      }
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
        throw new Error(
          'Extension session received an invalid backup-code attach.',
        )
      }
      const activeManager = await dependencies.getManager()
      const openArgs: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(openArgs)
      const attachResult =
        await activeManager.attach_authenticator_backup_codes_js(
          payload.secretId,
          payload.codes,
          payload.mode,
        )
      try {
        if (!attachResult.backupCodesVerified) {
          throw new Error(
            'Extension session could not verify persisted backup codes.',
          )
        }
        if (!attachResult.reviewed_input_persisted) {
          throw new Error(
            'Extension session could not verify the reviewed backup codes.',
          )
        }
        const flushArgs: Parameters<typeof flushPasskeyEventToProviders>[0] = {
          activeManager,
          vaultStoreId: grant.vaultStoreId,
        }
        await flushPasskeyEventToProviders(flushArgs)
        return {
          ok: true,
          secretId: attachResult.secretId,
          backupCodesVerified: true,
          reviewedInputPersisted: true,
        }
      } finally {
        attachResult.free()
      }
    }
  }
}
