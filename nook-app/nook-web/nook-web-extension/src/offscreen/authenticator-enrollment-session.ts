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

enum EnrollmentAuthorizationState {
  Authorized = 'authorized',
  Committing = 'committing',
}

type EnrollmentAuthorization = {
  state: EnrollmentAuthorizationState
  expiresAt: number
}

const enrollmentAuthorizations = new Map<string, EnrollmentAuthorization>()

type AuthorizeAuthenticatorEnrollmentArgs = {
  enrollmentAuthorizationId: string
  expiresAt: number
}

export function authorizeAuthenticatorEnrollment({
  enrollmentAuthorizationId,
  expiresAt,
}: AuthorizeAuthenticatorEnrollmentArgs): boolean {
  if (expiresAt <= Date.now()) return false
  const authorization: EnrollmentAuthorization = {
    state: EnrollmentAuthorizationState.Authorized,
    expiresAt,
  }
  enrollmentAuthorizations.set(enrollmentAuthorizationId, authorization)
  return true
}

export function revokeAuthenticatorEnrollment(
  enrollmentAuthorizationId: string,
): boolean {
  const authorization = enrollmentAuthorizations.get(enrollmentAuthorizationId)
  if (!authorization) return true
  if (authorization.state === EnrollmentAuthorizationState.Committing) {
    return false
  }
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
    enrollmentAuthorizations.delete(enrollmentAuthorizationId)
    return false
  }
  authorization.state = EnrollmentAuthorizationState.Committing
  return true
}

function completeAuthenticatorEnrollment(
  enrollmentAuthorizationId: string,
): void {
  enrollmentAuthorizations.delete(enrollmentAuthorizationId)
}

type EnrollmentAuthorizationControlMessage = {
  type:
    | 'nook:extension-authenticator-enrollment-authorize'
    | 'nook:extension-authenticator-enrollment-revoke'
  payload: {
    enrollmentAuthorizationId: string
    expiresAt?: number
  }
}

type EnrollmentAuthorizationControlCandidate = {
  type?: string
  payload?: {
    enrollmentAuthorizationId?: string
    expiresAt?: number
  }
}

function isEnrollmentAuthorizationControlMessage(
  message: EnrollmentAuthorizationControlCandidate,
): message is EnrollmentAuthorizationControlMessage {
  return (
    (message.type === 'nook:extension-authenticator-enrollment-authorize' ||
      message.type === 'nook:extension-authenticator-enrollment-revoke') &&
    !!message.payload &&
    typeof message.payload.enrollmentAuthorizationId === 'string'
  )
}

export function registerAuthenticatorEnrollmentAuthorizationListener(): void {
  // eslint-disable-next-line max-params -- Chrome owns the runtime listener callback signature.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const candidate = message as EnrollmentAuthorizationControlCandidate
    if (!isEnrollmentAuthorizationControlMessage(candidate)) return false
    const controlMessage = candidate
    const serviceWorkerSender =
      sender.id === chrome.runtime.id &&
      !sender.tab &&
      (!sender.url ||
        sender.url === chrome.runtime.getURL('background/service-worker.js'))
    if (!serviceWorkerSender) {
      const forbiddenResponse: Parameters<typeof sendResponse>[0] = {
        ok: false,
        accepted: false,
      }
      sendResponse(forbiddenResponse)
      return false
    }
    const { enrollmentAuthorizationId } = controlMessage.payload
    const authorizeArgs: AuthorizeAuthenticatorEnrollmentArgs = {
      enrollmentAuthorizationId,
      expiresAt: controlMessage.payload.expiresAt ?? 0,
    }
    const accepted =
      controlMessage.type ===
      'nook:extension-authenticator-enrollment-authorize'
        ? typeof controlMessage.payload.expiresAt === 'number' &&
          Number.isSafeInteger(controlMessage.payload.expiresAt) &&
          authorizeAuthenticatorEnrollment(authorizeArgs)
        : revokeAuthenticatorEnrollment(enrollmentAuthorizationId)
    const response: Parameters<typeof sendResponse>[0] = { ok: true, accepted }
    sendResponse(response)
    return false
  })
}

export async function handleAuthenticatorEnrollmentMessage({
  message,
  dependencies,
}: AuthenticatorEnrollmentMessageHandlingRequest) {
  switch (message.type) {
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
        typeof payload.origin !== 'string' ||
        !('enrollmentAuthorizationId' in payload) ||
        typeof payload.enrollmentAuthorizationId !== 'string'
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
        return { ok: true, secretId }
      } finally {
        completeAuthenticatorEnrollment(enrollmentAuthorizationId)
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
