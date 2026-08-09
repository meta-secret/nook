import { hasOriginPayload } from './origin-runtime-message'
import type { WebsiteAuthenticatorOption } from './login-fill-messages'

export const MAX_AUTHENTICATOR_SEARCH_LENGTH = 200

export enum WebsiteAuthenticatorPickerOpenMessageType {
  NookWebsiteAuthenticatorPickerOpen = 'nook:website-authenticator-picker-open',
}

export type WebsiteAuthenticatorPickerOpenMessage = {
  type: WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen
  payload: {
    origin: string
  }
}

export enum AuthenticatorPickerQueryMessageType {
  NookAuthenticatorPickerQuery = 'nook:authenticator-picker-query',
}

export type AuthenticatorPickerQueryMessage = {
  type: AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery
  payload: {
    requestId: string
    query: string
  }
}

export enum AuthenticatorPickerSelectMessageType {
  NookAuthenticatorPickerSelect = 'nook:authenticator-picker-select',
}

export type AuthenticatorPickerSelectMessage = {
  type: AuthenticatorPickerSelectMessageType.NookAuthenticatorPickerSelect
  payload: {
    requestId: string
    vaultStoreId: string
    secretId: string
  }
}

export enum AuthenticatorPickerCancelMessageType {
  NookAuthenticatorPickerCancel = 'nook:authenticator-picker-cancel',
}

export type AuthenticatorPickerCancelMessage = {
  type: AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel
  payload: {
    requestId: string
  }
}

export enum WebsiteAuthenticatorSelectedMessageType {
  NookWebsiteAuthenticatorSelected = 'nook:website-authenticator-selected',
}

export type WebsiteAuthenticatorSelectedMessage = {
  type: WebsiteAuthenticatorSelectedMessageType.NookWebsiteAuthenticatorSelected
  payload: {
    origin: string
    requestId: string
    account: Pick<WebsiteAuthenticatorOption, 'vaultStoreId' | 'secretId'>
  }
}

export enum WebsiteAuthenticatorCanceledMessageType {
  NookWebsiteAuthenticatorCanceled = 'nook:website-authenticator-canceled',
}

export type WebsiteAuthenticatorCanceledMessage = {
  type: WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled
  payload: {
    origin: string
    requestId: string
  }
}

function isNonEmptyString(value: string): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isWebsiteAuthenticatorPickerOpenMessage(
  message: object,
): message is WebsiteAuthenticatorPickerOpenMessage {
  return (
    hasOriginPayload(message) &&
    message.type ===
      WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen
  )
}

export function isAuthenticatorPickerQueryMessage(
  message: object,
): message is AuthenticatorPickerQueryMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !==
      AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    return false
  }
  const payload = message.payload as AuthenticatorPickerQueryMessage['payload']

  return (
    isNonEmptyString(payload.requestId) &&
    typeof payload.query === 'string' &&
    payload.query.length <= MAX_AUTHENTICATOR_SEARCH_LENGTH
  )
}

export function isAuthenticatorPickerSelectMessage(
  message: object,
): message is AuthenticatorPickerSelectMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !==
      AuthenticatorPickerSelectMessageType.NookAuthenticatorPickerSelect ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    return false
  }
  const payload = message.payload as AuthenticatorPickerSelectMessage['payload']

  return (
    isNonEmptyString(payload.requestId) &&
    isNonEmptyString(payload.vaultStoreId) &&
    isNonEmptyString(payload.secretId)
  )
}

export function isAuthenticatorPickerCancelMessage(
  message: object,
): message is AuthenticatorPickerCancelMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !==
      AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    return false
  }
  const payload = message.payload as AuthenticatorPickerCancelMessage['payload']

  return isNonEmptyString(payload.requestId)
}

export function isWebsiteAuthenticatorSelectedMessage(
  message: object,
): message is WebsiteAuthenticatorSelectedMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !==
      WebsiteAuthenticatorSelectedMessageType.NookWebsiteAuthenticatorSelected ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    return false
  }
  const payload =
    message.payload as WebsiteAuthenticatorSelectedMessage['payload']

  if (
    !isNonEmptyString(payload.origin) ||
    !isNonEmptyString(payload.requestId) ||
    !payload.account ||
    typeof payload.account !== 'object'
  ) {
    return false
  }
  const account =
    payload.account as WebsiteAuthenticatorSelectedMessage['payload']['account']

  return (
    isNonEmptyString(account.vaultStoreId) && isNonEmptyString(account.secretId)
  )
}

export function isWebsiteAuthenticatorCanceledMessage(
  message: object,
): message is WebsiteAuthenticatorCanceledMessage {
  if (!hasOriginPayload(message)) return false
  const payload =
    message.payload as WebsiteAuthenticatorCanceledMessage['payload']

  return (
    message.type ===
      WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled &&
    isNonEmptyString(payload.requestId)
  )
}
