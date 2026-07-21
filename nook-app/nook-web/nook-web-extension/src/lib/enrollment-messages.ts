import { hasOriginPayload } from './origin-runtime-message'

export type WebsiteAuthenticatorEnrollPreviewMessage = {
  type: 'nook:website-authenticator-enroll-preview'
  payload: {
    origin: string
    otpauthUri: string
  }
}

export type WebsiteAuthenticatorEnrollConfirmMessage = {
  type: 'nook:website-authenticator-enroll-confirm'
  payload: {
    origin: string
    vaultStoreId: string
    otpauthUri: string
  }
}

export type WebsiteAuthenticatorBackupAttachMessage = {
  type: 'nook:website-authenticator-backup-attach'
  payload: {
    origin: string
    vaultStoreId: string
    secretId: string
    codes: string[]
    mode: 'replace' | 'merge'
  }
}

export type OtpauthEnrollmentPreview = {
  issuer: string
  account: string
  websiteUrl: string
  algorithm: string
  digits: number
  period: number
}

export function isWebsiteAuthenticatorEnrollPreviewMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollPreviewMessage {
  if (!hasOriginPayload(message, 'nook:website-authenticator-enroll-preview')) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return (
    typeof payload.otpauthUri === 'string' &&
    payload.otpauthUri.startsWith('otpauth://totp/')
  )
}

export function isWebsiteAuthenticatorEnrollConfirmMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollConfirmMessage {
  if (!hasOriginPayload(message, 'nook:website-authenticator-enroll-confirm')) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    typeof payload.otpauthUri === 'string' &&
    payload.otpauthUri.startsWith('otpauth://totp/')
  )
}

export function isWebsiteAuthenticatorBackupAttachMessage(
  message: unknown,
): message is WebsiteAuthenticatorBackupAttachMessage {
  if (!hasOriginPayload(message, 'nook:website-authenticator-backup-attach')) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    typeof payload.secretId === 'string' &&
    payload.secretId.length > 0 &&
    Array.isArray(payload.codes) &&
    payload.codes.every((code) => typeof code === 'string') &&
    (payload.mode === 'replace' || payload.mode === 'merge')
  )
}
