import type { WebsiteAuthenticatorBackupAttachMessageMode } from '../../lib/enrollment-messages'
import {
  extensionSessionGrantIdentity,
  type StoredExtensionPairingGrant,
} from '../pairing-grants'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../offscreen/session-request-adapter'
import { extensionPairingIdentity } from './pairing-identity'

import {
  decode_authenticator_code_session_response,
  decode_authenticator_preview_session_response,
  decode_authenticator_secret_session_response,
  decode_authenticator_backup_verification_session_response,
  type AuthenticatorCodeSessionResponse,
  type AuthenticatorPreviewSessionResponse,
  type AuthenticatorSecretSessionResponse,
  type VerifiedAuthenticatorBackupAttachResponse,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
export type {
  AuthenticatorCodeSessionResponse,
  AuthenticatorPreviewSessionResponse,
  AuthenticatorSecretSessionResponse,
  VerifiedAuthenticatorBackupAttachResponse,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type AuthenticatorCodeFromSessionArgs = {
  grant: StoredExtensionPairingGrant
  secretId: string
}

export async function authenticatorCodeFromSession({
  grant,
  secretId,
}: AuthenticatorCodeFromSessionArgs): Promise<AuthenticatorCodeSessionResponse> {
  await companionWasmReady
  const message: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-authenticator-code',
    payload: {
      ...extensionSessionGrantIdentity(grant),
      secretId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const response = decode_authenticator_code_session_response(
    await extensionPairingIdentity.sendSessionMessage(message),
  )
  if (response.expiresAt <= Date.now()) {
    throw new Error('Extension session returned an invalid authenticator code.')
  }
  return response
}

export async function authenticatorPreviewFromSession(
  otpauthUri: string,
): Promise<AuthenticatorPreviewSessionResponse> {
  await companionWasmReady
  const message: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-authenticator-enroll-preview',
    payload: { otpauthUri, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  return decode_authenticator_preview_session_response(
    await extensionPairingIdentity.sendSessionMessage(message),
  )
}

export async function stagedAuthenticatorCodeFromSession(
  otpauthUri: string,
): Promise<AuthenticatorCodeSessionResponse> {
  await companionWasmReady
  const message: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-authenticator-enroll-code',
    payload: { otpauthUri, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const response = decode_authenticator_code_session_response(
    await extensionPairingIdentity.sendSessionMessage(message),
  )
  if (response.expiresAt <= Date.now()) {
    throw new Error('Extension session returned an invalid staged code.')
  }
  return response
}

type ConfirmAuthenticatorEnrollmentArgs = {
  grant: StoredExtensionPairingGrant
  otpauthUri: string
  origin: string
}

export async function confirmAuthenticatorEnrollment({
  grant,
  otpauthUri,
  origin,
}: ConfirmAuthenticatorEnrollmentArgs): Promise<AuthenticatorSecretSessionResponse> {
  await companionWasmReady
  const message: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-authenticator-enroll-confirm',
    payload: {
      ...extensionSessionGrantIdentity(grant),
      otpauthUri,
      origin,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  return decode_authenticator_secret_session_response(
    await extensionPairingIdentity.sendSessionMessage(message),
  )
}

type AuthenticatorBackupCodesSessionAttachmentRequest = {
  grant: StoredExtensionPairingGrant
  secretId: string
  codes: string[]
  mode: WebsiteAuthenticatorBackupAttachMessageMode
}

export async function attachAuthenticatorBackupCodesFromSession({
  grant,
  secretId,
  codes,
  mode,
}: AuthenticatorBackupCodesSessionAttachmentRequest): Promise<VerifiedAuthenticatorBackupAttachResponse> {
  await companionWasmReady
  const transportCodes = [...codes]
  const message: Parameters<
    typeof extensionPairingIdentity.sendSessionMessage
  >[0] = {
    type: 'nook:extension-session-authenticator-backup-attach',
    payload: {
      ...extensionSessionGrantIdentity(grant),
      secretId,
      codes: transportCodes,
      mode,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  try {
    return decode_authenticator_backup_verification_session_response(
      await extensionPairingIdentity.sendSessionMessage(message),
    )
  } finally {
    transportCodes.fill('')
  }
}

type SelectedAuthenticatorPageAcknowledgedArgs = {
  tabId: number
  frameId: number
  origin: string
  requestId: string
  vaultStoreId: string
  secretId: string
  authorizationGeneration: string
}

export async function selectedAuthenticatorPageAcknowledged({
  tabId,
  frameId,
  origin,
  requestId,
  vaultStoreId,
  secretId,
  authorizationGeneration,
}: SelectedAuthenticatorPageAcknowledgedArgs): Promise<boolean> {
  const message: Parameters<typeof chrome.tabs.sendMessage>[1] = {
    type: 'nook:website-authenticator-selected',
    payload: {
      origin,
      requestId,
      account: { vaultStoreId, secretId, authorizationGeneration },
    },
  }
  const options: ChromeTabMessageOptions = { frameId }
  const response: unknown = await chrome.tabs.sendMessage(
    tabId,
    message,
    options,
  )
  return (
    !!response &&
    typeof response === 'object' &&
    'ok' in response &&
    response.ok === true
  )
}
