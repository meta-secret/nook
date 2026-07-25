import { hasOriginPayload } from './origin-runtime-message'
import type { WebsiteLoginAccountOption } from './login-fill-messages'

export const MAX_LOGIN_SEARCH_LENGTH = 200

export type WebsiteLoginPickerOpenMessage = {
  type: 'nook:website-login-picker-open'
  payload: {
    origin: string
  }
}

export type LoginPickerQueryMessage = {
  type: 'nook:login-picker-query'
  payload: {
    requestId: string
    query: string
  }
}

export type LoginPickerSelectMessage = {
  type: 'nook:login-picker-select'
  payload: {
    requestId: string
    vaultStoreId: string
    secretId: string
  }
}

export type LoginPickerCancelMessage = {
  type: 'nook:login-picker-cancel'
  payload: {
    requestId: string
  }
}

export type WebsiteLoginSelectedMessage = {
  type: 'nook:website-login-selected'
  payload: {
    origin: string
    requestId: string
    account: Pick<WebsiteLoginAccountOption, 'vaultStoreId' | 'secretId'>
  }
}

export type WebsiteLoginCanceledMessage = {
  type: 'nook:website-login-canceled'
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
    message.type !== 'nook:login-picker-query' ||
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
    message.type !== 'nook:login-picker-select' ||
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
    message.type !== 'nook:login-picker-cancel' ||
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
    message.type !== 'nook:website-login-selected' ||
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
