import { hasOriginPayload } from './origin-runtime-message'

export enum WebsiteAuthenticatorEnrollPreviewMessageType {
  NookWebsiteAuthenticatorEnrollPreview = 'nook:website-authenticator-enroll-preview',
}

export type WebsiteAuthenticatorEnrollPreviewMessage = {
  type: WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview
  payload: {
    origin: string
    otpauthUri: string
  }
}

export enum WebsiteAuthenticatorEnrollStageMessageType {
  NookWebsiteAuthenticatorEnrollStage = 'nook:website-authenticator-enroll-stage',
}

export type WebsiteAuthenticatorEnrollStageMessage = {
  type: WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage
  payload: {
    origin: string
    vaultStoreId: string
    otpauthUri: string
  }
}

export enum WebsiteAuthenticatorEnrollCodeMessageType {
  NookWebsiteAuthenticatorEnrollCode = 'nook:website-authenticator-enroll-code',
}

export type WebsiteAuthenticatorEnrollCodeMessage = {
  type: WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode
  payload: {
    origin: string
    stageId: string
  }
}

export enum WebsiteAuthenticatorEnrollConfirmMessageType {
  NookWebsiteAuthenticatorEnrollConfirm = 'nook:website-authenticator-enroll-confirm',
}

export type WebsiteAuthenticatorEnrollConfirmMessage = {
  type: WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm
  payload: {
    origin: string
    vaultStoreId: string
    stageId: string
  }
}

export enum WebsiteAuthenticatorEnrollDismissMessageType {
  NookWebsiteAuthenticatorEnrollDismiss = 'nook:website-authenticator-enroll-dismiss',
}

export type WebsiteAuthenticatorEnrollDismissMessage = {
  type: WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss
  payload: {
    origin: string
    stageId: string
  }
}

export enum WebsiteAuthenticatorEnrollPendingMessageType {
  NookWebsiteAuthenticatorEnrollPending = 'nook:website-authenticator-enroll-pending',
}

export type WebsiteAuthenticatorEnrollPendingMessage = {
  type: WebsiteAuthenticatorEnrollPendingMessageType.NookWebsiteAuthenticatorEnrollPending
  payload: {
    origin: string
  }
}

export enum WebsiteAuthenticatorBackupAttachMessageType {
  NookWebsiteAuthenticatorBackupAttach = 'nook:website-authenticator-backup-attach',
}

export enum WebsiteAuthenticatorBackupAttachMessageMode {
  Replace = 'replace',
  Merge = 'merge',
}

export type WebsiteAuthenticatorBackupAttachMessage = {
  type: WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach
  payload: {
    origin: string
    vaultStoreId: string
    secretId: string
    codes: string[]
    mode:
      | WebsiteAuthenticatorBackupAttachMessageMode.Replace
      | WebsiteAuthenticatorBackupAttachMessageMode.Merge
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
    (payload.mode === WebsiteAuthenticatorBackupAttachMessageMode.Replace ||
      payload.mode === WebsiteAuthenticatorBackupAttachMessageMode.Merge)
  )
}
