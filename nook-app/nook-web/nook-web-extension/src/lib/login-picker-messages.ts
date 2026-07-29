import { hasOriginPayload } from './origin-runtime-message'
import type { WebsiteLoginAccountOption } from './login-fill-messages'

export const MAX_LOGIN_SEARCH_LENGTH = 200

export enum WebsiteLoginPickerOpenMessageType {
  NookWebsiteLoginPickerOpen = 'nook:website-login-picker-open',
}

export type WebsiteLoginPickerOpenMessage = {
  type: WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen
  payload: {
    origin: string
  }
}

export enum LoginPickerQueryMessageType {
  NookLoginPickerQuery = 'nook:login-picker-query',
}

export type LoginPickerQueryMessage = {
  type: LoginPickerQueryMessageType.NookLoginPickerQuery
  payload: {
    requestId: string
    query: string
  }
}

export enum LoginPickerSelectMessageType {
  NookLoginPickerSelect = 'nook:login-picker-select',
}

export type LoginPickerSelectMessage = {
  type: LoginPickerSelectMessageType.NookLoginPickerSelect
  payload: {
    requestId: string
    vaultStoreId: string
    secretId: string
  }
}

export enum LoginPickerCancelMessageType {
  NookLoginPickerCancel = 'nook:login-picker-cancel',
}

export type LoginPickerCancelMessage = {
  type: LoginPickerCancelMessageType.NookLoginPickerCancel
  payload: {
    requestId: string
  }
}

export enum WebsiteLoginSelectedMessageType {
  NookWebsiteLoginSelected = 'nook:website-login-selected',
}

export type WebsiteLoginSelectedMessage = {
  type: WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected
  payload: {
    origin: string
    requestId: string
    account: Pick<WebsiteLoginAccountOption, 'vaultStoreId' | 'secretId'>
  }
}

export enum WebsiteLoginCanceledMessageType {
  NookWebsiteLoginCanceled = 'nook:website-login-canceled',
}

export type WebsiteLoginCanceledMessage = {
  type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled
  payload: {
    origin: string
    requestId: string
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isWebsiteLoginPickerOpenMessage(
  message: unknown,
): message is WebsiteLoginPickerOpenMessage {
  return hasOriginPayload(message, 'nook:website-login-picker-open')
}

export function isLoginPickerQueryMessage(
  message: unknown,
): message is LoginPickerQueryMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== LoginPickerQueryMessageType.NookLoginPickerQuery ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return (
    isNonEmptyString(payload.requestId) &&
    typeof payload.query === 'string' &&
    payload.query.length <= MAX_LOGIN_SEARCH_LENGTH
  )
}

export function isLoginPickerSelectMessage(
  message: unknown,
): message is LoginPickerSelectMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== LoginPickerSelectMessageType.NookLoginPickerSelect ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return (
    isNonEmptyString(payload.requestId) &&
    isNonEmptyString(payload.vaultStoreId) &&
    isNonEmptyString(payload.secretId)
  )
}

export function isLoginPickerCancelMessage(
  message: unknown,
): message is LoginPickerCancelMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== LoginPickerCancelMessageType.NookLoginPickerCancel ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return isNonEmptyString(payload.requestId)
}

export function isWebsiteLoginSelectedMessage(
  message: unknown,
): message is WebsiteLoginSelectedMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  if (
    !isNonEmptyString(payload.origin) ||
    !isNonEmptyString(payload.requestId) ||
    !payload.account ||
    typeof payload.account !== 'object'
  ) {
    return false
  }
  const account = payload.account as Record<string, unknown>
  return (
    isNonEmptyString(account.vaultStoreId) && isNonEmptyString(account.secretId)
  )
}

export function isWebsiteLoginCanceledMessage(
  message: unknown,
): message is WebsiteLoginCanceledMessage {
  return (
    hasOriginPayload(message, 'nook:website-login-canceled') &&
    isNonEmptyString(message.payload.requestId)
  )
}
