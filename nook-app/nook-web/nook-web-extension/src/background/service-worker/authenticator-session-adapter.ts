import type {
  OtpauthEnrollmentPreview,
  WebsiteAuthenticatorBackupAttachMessageMode,
} from '../../lib/enrollment-messages'
import {
  extensionSessionGrantIdentity,
  type StoredExtensionPairingGrant,
} from '../pairing-grants'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../offscreen/session-request-adapter'
import { sendSessionMessage } from './pairing-identity'

export type AuthenticatorCodeSessionResponse = {
  ok: true
  code: string
  expiresAt: number
}

export type AuthenticatorPreviewSessionResponse = {
  ok: true
  preview: OtpauthEnrollmentPreview
}

export type AuthenticatorSecretSessionResponse = {
  ok: true
  secretId: string
}

export type VerifiedAuthenticatorBackupAttachResponse = {
  ok: true
  secretId: string
  backupCodesVerified: true
  reviewedInputPersisted: true
}

function responseRecord(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== 'object') {
    throw new Error('Extension session returned an invalid response.')
  }
  return response as Record<string, unknown>
}

type AuthenticatorCodeFromSessionArgs = {
  grant: StoredExtensionPairingGrant
  secretId: string
}

export async function authenticatorCodeFromSession({
  grant,
  secretId,
}: AuthenticatorCodeFromSessionArgs): Promise<AuthenticatorCodeSessionResponse> {
  const message: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-authenticator-code',
    payload: {
      ...extensionSessionGrantIdentity(grant),
      secretId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const response = responseRecord(await sendSessionMessage(message))
  if (
    response.ok !== true ||
    typeof response.code !== 'string' ||
    typeof response.expiresAt !== 'number' ||
    !Number.isSafeInteger(response.expiresAt) ||
    response.expiresAt <= Date.now()
  ) {
    throw new Error('Extension session returned an invalid authenticator code.')
  }
  return { ok: true, code: response.code, expiresAt: response.expiresAt }
}

export async function authenticatorPreviewFromSession(
  otpauthUri: string,
): Promise<AuthenticatorPreviewSessionResponse> {
  const message: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-authenticator-enroll-preview',
    payload: { otpauthUri, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const response = responseRecord(await sendSessionMessage(message))
  const preview = response.preview
  if (
    response.ok !== true ||
    !preview ||
    typeof preview !== 'object' ||
    !('issuer' in preview) ||
    typeof preview.issuer !== 'string' ||
    !('account' in preview) ||
    typeof preview.account !== 'string' ||
    !('websiteUrl' in preview) ||
    typeof preview.websiteUrl !== 'string' ||
    !('algorithm' in preview) ||
    typeof preview.algorithm !== 'string' ||
    !('digits' in preview) ||
    typeof preview.digits !== 'number' ||
    !('period' in preview) ||
    typeof preview.period !== 'number'
  ) {
    throw new Error('Extension session returned an invalid preview.')
  }
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
}

export async function stagedAuthenticatorCodeFromSession(
  otpauthUri: string,
): Promise<AuthenticatorCodeSessionResponse> {
  const message: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-authenticator-enroll-code',
    payload: { otpauthUri, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
  }
  const response = responseRecord(await sendSessionMessage(message))
  if (
    response.ok !== true ||
    typeof response.code !== 'string' ||
    typeof response.expiresAt !== 'number' ||
    !Number.isSafeInteger(response.expiresAt) ||
    response.expiresAt <= Date.now()
  ) {
    throw new Error('Extension session returned an invalid staged code.')
  }
  return { ok: true, code: response.code, expiresAt: response.expiresAt }
}

type ConfirmAuthenticatorEnrollmentArgs = {
  grant: StoredExtensionPairingGrant
  otpauthUri: string
  origin: string
  enrollmentAuthorizationId: string
}

type AuthenticatorEnrollmentConfirmSessionMessage = Extract<
  Parameters<typeof sendSessionMessage>[0],
  { type: 'nook:extension-session-authenticator-enroll-confirm' }
> & {
  payload: Extract<
    Parameters<typeof sendSessionMessage>[0],
    { type: 'nook:extension-session-authenticator-enroll-confirm' }
  >['payload'] & { enrollmentAuthorizationId: string }
}

export async function confirmAuthenticatorEnrollment({
  grant,
  otpauthUri,
  origin,
  enrollmentAuthorizationId,
}: ConfirmAuthenticatorEnrollmentArgs): Promise<AuthenticatorSecretSessionResponse> {
  const message: AuthenticatorEnrollmentConfirmSessionMessage = {
    type: 'nook:extension-session-authenticator-enroll-confirm',
    payload: {
      ...extensionSessionGrantIdentity(grant),
      otpauthUri,
      origin,
      enrollmentAuthorizationId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  const response = await sendSessionMessage(message)
  return authenticatorSecretResponse(response)
}

type AuthenticatorEnrollmentAuthorizationControlResponse = {
  ok: true
  accepted: boolean
}

function enrollmentAuthorizationControlResponse(
  response: unknown,
): AuthenticatorEnrollmentAuthorizationControlResponse {
  const record = responseRecord(response)
  if (record.ok !== true || typeof record.accepted !== 'boolean') {
    throw new Error(
      'Extension session returned an invalid enrollment authorization response.',
    )
  }
  return { ok: true, accepted: record.accepted }
}

type AuthorizeAuthenticatorEnrollmentFromSessionArgs = {
  enrollmentAuthorizationId: string
  expiresAt: number
}

type AuthorizeAuthenticatorEnrollmentControlMessage = {
  type: 'nook:extension-authenticator-enrollment-authorize'
  payload: AuthorizeAuthenticatorEnrollmentFromSessionArgs
}

type RevokeAuthenticatorEnrollmentControlMessage = {
  type: 'nook:extension-authenticator-enrollment-revoke'
  payload: { enrollmentAuthorizationId: string }
}

export async function authorizeAuthenticatorEnrollmentFromSession({
  enrollmentAuthorizationId,
  expiresAt,
}: AuthorizeAuthenticatorEnrollmentFromSessionArgs): Promise<boolean> {
  const message: AuthorizeAuthenticatorEnrollmentControlMessage = {
    type: 'nook:extension-authenticator-enrollment-authorize',
    payload: { enrollmentAuthorizationId, expiresAt },
  }
  const response: unknown = await chrome.runtime.sendMessage(message)
  return enrollmentAuthorizationControlResponse(response).accepted
}

export async function revokeAuthenticatorEnrollmentFromSession(
  enrollmentAuthorizationId: string,
): Promise<boolean> {
  const message: RevokeAuthenticatorEnrollmentControlMessage = {
    type: 'nook:extension-authenticator-enrollment-revoke',
    payload: { enrollmentAuthorizationId },
  }
  const response: unknown = await chrome.runtime.sendMessage(message)
  return enrollmentAuthorizationControlResponse(response).accepted
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
  const transportCodes = [...codes]
  const message: Parameters<typeof sendSessionMessage>[0] = {
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
    return verifiedAuthenticatorBackupAttachResponse(
      await sendSessionMessage(message),
    )
  } finally {
    transportCodes.fill('')
  }
}

function authenticatorSecretResponse(
  response: unknown,
): AuthenticatorSecretSessionResponse {
  const record = responseRecord(response)
  if (record.ok !== true || typeof record.secretId !== 'string') {
    throw new Error('Extension session returned an invalid secret response.')
  }
  return { ok: true, secretId: record.secretId }
}

function verifiedAuthenticatorBackupAttachResponse(
  response: unknown,
): VerifiedAuthenticatorBackupAttachResponse {
  const record = responseRecord(response)
  if (
    record.ok !== true ||
    typeof record.secretId !== 'string' ||
    record.backupCodesVerified !== true ||
    record.reviewedInputPersisted !== true
  ) {
    throw new Error(
      'Extension session did not verify persisted authenticator backup codes.',
    )
  }
  return {
    ok: true,
    secretId: record.secretId,
    backupCodesVerified: true,
    reviewedInputPersisted: true,
  }
}

type SelectedAuthenticatorPageAcknowledgedArgs = {
  tabId: number
  origin: string
  requestId: string
  vaultStoreId: string
  secretId: string
  authorizationGeneration: string
}

export async function selectedAuthenticatorPageAcknowledged({
  tabId,
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
  const response: unknown = await chrome.tabs.sendMessage(tabId, message)
  return (
    !!response &&
    typeof response === 'object' &&
    'ok' in response &&
    response.ok === true
  )
}
