import type { OtpauthEnrollmentPreview } from '../../lib/enrollment-messages'
import type { StoredExtensionPairingGrant } from '../pairing-grants'
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

function responseRecord(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== 'object') {
    throw new Error('Extension session returned an invalid response.')
  }
  return response as Record<string, unknown>
}

export async function authenticatorCodeFromSession({
  grant,
  secretId,
}: {
  grant: StoredExtensionPairingGrant
  secretId: string
}): Promise<AuthenticatorCodeSessionResponse> {
  const message: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-authenticator-code',
    payload: { ...grant, secretId },
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
    payload: { otpauthUri },
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
    payload: { otpauthUri },
  }
  const response = responseRecord(await sendSessionMessage(message))
  if (response.ok !== true || typeof response.code !== 'string') {
    throw new Error('Extension session returned an invalid staged code.')
  }
  return { ok: true, code: response.code }
}

export async function confirmAuthenticatorEnrollment({
  grant,
  otpauthUri,
  origin,
}: {
  grant: StoredExtensionPairingGrant
  otpauthUri: string
  origin: string
}): Promise<AuthenticatorSecretSessionResponse> {
  const message: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-authenticator-enroll-confirm',
    payload: { ...grant, otpauthUri, origin },
  }
  return authenticatorSecretResponse(await sendSessionMessage(message))
}

export async function attachAuthenticatorBackupCodes({
  grant,
  secretId,
  codes,
  mode,
}: {
  grant: StoredExtensionPairingGrant
  secretId: string
  codes: string[]
  mode: 'replace' | 'merge'
}): Promise<AuthenticatorSecretSessionResponse> {
  const message: Parameters<typeof sendSessionMessage>[0] = {
    type: 'nook:extension-session-authenticator-backup-attach',
    payload: { ...grant, secretId, codes, mode },
  }
  return authenticatorSecretResponse(await sendSessionMessage(message))
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

export async function selectedAuthenticatorPageAcknowledged({
  tabId,
  origin,
  requestId,
  vaultStoreId,
  secretId,
}: {
  tabId: number
  origin: string
  requestId: string
  vaultStoreId: string
  secretId: string
}): Promise<boolean> {
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
