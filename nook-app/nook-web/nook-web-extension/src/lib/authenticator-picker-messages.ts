import { hasOriginPayload } from './origin-runtime-message'
import type { WebsiteAuthenticatorOption } from './login-fill-messages'

export const MAX_AUTHENTICATOR_SEARCH_LENGTH = 200

export type WebsiteAuthenticatorPickerOpenMessage = {
  type: 'nook:website-authenticator-picker-open'
  payload: {
    origin: string
  }
}

export type AuthenticatorPickerQueryMessage = {
  type: 'nook:authenticator-picker-query'
  payload: {
    requestId: string
    query: string
  }
}

export type AuthenticatorPickerSelectMessage = {
  type: 'nook:authenticator-picker-select'
  payload: {
    requestId: string
    vaultStoreId: string
    secretId: string
  }
}

export type WebsiteAuthenticatorSelectedMessage = {
  type: 'nook:website-authenticator-selected'
  payload: {
    origin: string
    requestId: string
    account: Pick<WebsiteAuthenticatorOption, 'vaultStoreId' | 'secretId'>
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isWebsiteAuthenticatorPickerOpenMessage(
  message: unknown,
): message is WebsiteAuthenticatorPickerOpenMessage {
  return hasOriginPayload(message, 'nook:website-authenticator-picker-open')
}

export function isAuthenticatorPickerQueryMessage(
  message: unknown,
): message is AuthenticatorPickerQueryMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== 'nook:authenticator-picker-query' ||
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
    payload.query.length <= MAX_AUTHENTICATOR_SEARCH_LENGTH
  )
}

export function isAuthenticatorPickerSelectMessage(
  message: unknown,
): message is AuthenticatorPickerSelectMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== 'nook:authenticator-picker-select' ||
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

export function isWebsiteAuthenticatorSelectedMessage(
  message: unknown,
): message is WebsiteAuthenticatorSelectedMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== 'nook:website-authenticator-selected' ||
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
