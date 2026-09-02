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
    stageId: string
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

function isOtpauthTotpUri(value: string): value is string {
  return typeof value === 'string' && value.startsWith('otpauth://totp/')
}

const MAX_ENROLLMENT_STAGE_ID_LENGTH = 64

export function isBoundedEnrollmentStageId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ENROLLMENT_STAGE_ID_LENGTH
  )
}

export function isWebsiteAuthenticatorEnrollPreviewMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollPreviewMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview
  ) {
    return false
  }
  const payload =
    message.payload as WebsiteAuthenticatorEnrollPreviewMessage['payload']

  return isOtpauthTotpUri(payload.otpauthUri)
}

export function isWebsiteAuthenticatorEnrollStageMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollStageMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage
  ) {
    return false
  }
  const payload =
    message.payload as WebsiteAuthenticatorEnrollStageMessage['payload']

  return (
    isBoundedEnrollmentStageId(payload.stageId) &&
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    isOtpauthTotpUri(payload.otpauthUri)
  )
}

export function isWebsiteAuthenticatorEnrollCodeMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollCodeMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode
  ) {
    return false
  }
  const payload =
    message.payload as WebsiteAuthenticatorEnrollCodeMessage['payload']

  return isBoundedEnrollmentStageId(payload.stageId)
}

export function isWebsiteAuthenticatorEnrollConfirmMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollConfirmMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm
  ) {
    return false
  }
  const payload =
    message.payload as WebsiteAuthenticatorEnrollConfirmMessage['payload']

  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    isBoundedEnrollmentStageId(payload.stageId)
  )
}

export function isWebsiteAuthenticatorEnrollDismissMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollDismissMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss
  ) {
    return false
  }
  const payload =
    message.payload as WebsiteAuthenticatorEnrollDismissMessage['payload']

  return isBoundedEnrollmentStageId(payload.stageId)
}

export function isWebsiteAuthenticatorEnrollPendingMessage(
  message: unknown,
): message is WebsiteAuthenticatorEnrollPendingMessage {
  return (
    hasOriginPayload(message) &&
    message.type ===
      WebsiteAuthenticatorEnrollPendingMessageType.NookWebsiteAuthenticatorEnrollPending
  )
}

export function isWebsiteAuthenticatorBackupAttachMessage(
  message: unknown,
): message is WebsiteAuthenticatorBackupAttachMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach
  ) {
    return false
  }
  const payload =
    message.payload as WebsiteAuthenticatorBackupAttachMessage['payload']

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
