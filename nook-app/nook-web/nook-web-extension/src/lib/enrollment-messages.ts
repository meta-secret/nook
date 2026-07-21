import { hasOriginPayload } from './origin-runtime-message'

export type WebsiteAuthenticatorEnrollPreviewMessage = {
  type: 'nook:website-authenticator-enroll-preview'
  payload: {
    origin: string
    otpauthUri: string
  }
}

export type WebsiteAuthenticatorEnrollStageMessage = {
  type: 'nook:website-authenticator-enroll-stage'
  payload: {
    origin: string
    vaultStoreId: string
    otpauthUri: string
  }
}

export type WebsiteAuthenticatorEnrollCodeMessage = {
  type: 'nook:website-authenticator-enroll-code'
  payload: {
    origin: string
    stageId: string
  }
}

export type WebsiteAuthenticatorEnrollConfirmMessage = {
  type: 'nook:website-authenticator-enroll-confirm'
  payload: {
    origin: string
    vaultStoreId: string
    stageId: string
  }
}

export type WebsiteAuthenticatorEnrollDismissMessage = {
  type: 'nook:website-authenticator-enroll-dismiss'
  payload: {
    origin: string
    stageId: string
  }
}

export type WebsiteAuthenticatorEnrollPendingMessage = {
  type: 'nook:website-authenticator-enroll-pending'
  payload: {
    origin: string
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

function isOtpauthTotpUri(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('otpauth://totp/')
}

export function isWebsiteAuthenticatorEnrollPreviewMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollPreviewMessage {
  if (!hasOriginPayload(message, 'nook:website-authenticator-enroll-preview')) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return isOtpauthTotpUri(payload.otpauthUri)
}

export function isWebsiteAuthenticatorEnrollStageMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollStageMessage {
  if (!hasOriginPayload(message, 'nook:website-authenticator-enroll-stage')) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    isOtpauthTotpUri(payload.otpauthUri)
  )
}

export function isWebsiteAuthenticatorEnrollCodeMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollCodeMessage {
  if (!hasOriginPayload(message, 'nook:website-authenticator-enroll-code')) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return typeof payload.stageId === 'string' && payload.stageId.length > 0
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
    typeof payload.stageId === 'string' &&
    payload.stageId.length > 0
  )
}

export function isWebsiteAuthenticatorEnrollDismissMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollDismissMessage {
  if (!hasOriginPayload(message, 'nook:website-authenticator-enroll-dismiss')) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return typeof payload.stageId === 'string' && payload.stageId.length > 0
}

export function isWebsiteAuthenticatorEnrollPendingMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollPendingMessage {
  return hasOriginPayload(message, 'nook:website-authenticator-enroll-pending')
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
