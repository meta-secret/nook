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
  if (response.ok !== true || typeof response.code !== 'string') {
    throw new Error('Extension session returned an invalid authenticator code.')
  }
  return { ok: true, code: response.code }
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
  if (response.ok !== true || typeof response.code !== 'string') {
    throw new Error('Extension session returned an invalid staged code.')
  }
  return { ok: true, code: response.code }
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
  const message: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-authenticator-enroll-confirm',
    payload: {
      ...extensionSessionGrantIdentity(grant),
      otpauthUri,
      origin,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
  return authenticatorSecretResponse(await sendSessionMessage(message))
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
}

export async function selectedAuthenticatorPageAcknowledged({
  tabId,
  origin,
  requestId,
  vaultStoreId,
  secretId,
}: SelectedAuthenticatorPageAcknowledgedArgs): Promise<boolean> {
  const message: Parameters<typeof chrome.tabs.sendMessage>[1] = {
    type: 'nook:website-authenticator-selected',
    payload: {
      origin,
      requestId,
      account: { vaultStoreId, secretId },
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
