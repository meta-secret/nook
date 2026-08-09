import type { ExternalValue } from './external-value'
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

function isOtpauthTotpUri(value: ExternalValue): value is string {
  return typeof value === 'string' && value.startsWith('otpauth://totp/')
}

export function isWebsiteAuthenticatorEnrollPreviewMessage(
  message: ExternalValue,
): message is WebsiteAuthenticatorEnrollPreviewMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview
  ) {
    return false
  }
  const payload = message.payload as Record<string, ExternalValue>
  return isOtpauthTotpUri(payload.otpauthUri)
}

export function isWebsiteAuthenticatorEnrollStageMessage(
  message: ExternalValue,
): message is WebsiteAuthenticatorEnrollStageMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage
  ) {
    return false
  }
  const payload = message.payload as Record<string, ExternalValue>
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    isOtpauthTotpUri(payload.otpauthUri)
  )
}

export function isWebsiteAuthenticatorEnrollCodeMessage(
  message: ExternalValue,
): message is WebsiteAuthenticatorEnrollCodeMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode
  ) {
    return false
  }
  const payload = message.payload as Record<string, ExternalValue>
  return typeof payload.stageId === 'string' && payload.stageId.length > 0
}

export function isWebsiteAuthenticatorEnrollConfirmMessage(
  message: ExternalValue,
): message is WebsiteAuthenticatorEnrollConfirmMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm
  ) {
    return false
  }
  const payload = message.payload as Record<string, ExternalValue>
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    typeof payload.stageId === 'string' &&
    payload.stageId.length > 0
  )
}

export function isWebsiteAuthenticatorEnrollDismissMessage(
  message: ExternalValue,
): message is WebsiteAuthenticatorEnrollDismissMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss
  ) {
    return false
  }
  const payload = message.payload as Record<string, ExternalValue>
  return typeof payload.stageId === 'string' && payload.stageId.length > 0
}

export function isWebsiteAuthenticatorEnrollPendingMessage(
  message: ExternalValue,
): message is WebsiteAuthenticatorEnrollPendingMessage {
  return (
    hasOriginPayload(message) &&
    message.type ===
      WebsiteAuthenticatorEnrollPendingMessageType.NookWebsiteAuthenticatorEnrollPending
  )
}

export function isWebsiteAuthenticatorBackupAttachMessage(
  message: ExternalValue,
): message is WebsiteAuthenticatorBackupAttachMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach
  ) {
    return false
  }
  const payload = message.payload as Record<string, ExternalValue>
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
