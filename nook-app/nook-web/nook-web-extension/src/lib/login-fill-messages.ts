import { hasOriginPayload } from './origin-runtime-message'

export type WebsiteLoginAccountOption = {
  vaultStoreId: string
  vaultName: string
  secretId: string
  username: string
  websiteUrl: string
  websiteHost: string
}

export type WebsiteAuthenticatorOption = {
  vaultStoreId: string
  vaultName: string
  secretId: string
  issuer: string
  account: string
}

export enum WebsiteLoginOptionsMessageType {
  NookWebsiteLoginOptions = 'nook:website-login-options',
}

export type WebsiteLoginOptionsMessage = {
  type: WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions
  payload: {
    origin: string
  }
}

export enum WebsiteLoginRevealMessageType {
  NookWebsiteLoginFill = 'nook:website-login-fill',
}

export type WebsiteLoginRevealMessage = {
  type: WebsiteLoginRevealMessageType.NookWebsiteLoginFill
  payload: {
    origin: string
    vaultStoreId: string
    secretId: string
  }
}

export enum WebsiteAuthenticatorOptionsMessageType {
  NookWebsiteAuthenticatorOptions = 'nook:website-authenticator-options',
}

export type WebsiteAuthenticatorOptionsMessage = {
  type: WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions
  payload: {
    origin: string
  }
}

export enum WebsiteAuthenticatorFillMessageType {
  NookWebsiteAuthenticatorFill = 'nook:website-authenticator-fill',
}

export type WebsiteAuthenticatorFillMessage = {
  type: WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill
  payload: {
    origin: string
    vaultStoreId: string
    secretId: string
  }
}

export function isWebsiteLoginOptionsMessage(
  message: object,
): message is WebsiteLoginOptionsMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions ||
    !('payload' in message) ||
    typeof message.payload !== 'object' ||
    !message.payload
  ) {
    return false
  }
  const payload = message.payload as Partial<WebsiteLoginOptionsMessage['payload']>
  return typeof payload.origin === 'string' && payload.origin.length > 0
}

export function isWebsiteAuthenticatorOptionsMessage(
  message: object,
): message is WebsiteAuthenticatorOptionsMessage {
  return (
    hasOriginPayload(message) &&
    message.type ===
      WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions
  )
}

export function isWebsiteAuthenticatorFillMessage(
  message: object,
): message is WebsiteAuthenticatorFillMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill
  ) {
    return false
  }
  const payload = message.payload as Partial<
    WebsiteAuthenticatorFillMessage['payload']
  >
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    typeof payload.secretId === 'string' &&
    payload.secretId.length > 0
  )
}

export function isWebsiteLoginRevealMessage(
  message: object,
): message is WebsiteLoginRevealMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== WebsiteLoginRevealMessageType.NookWebsiteLoginFill ||
    !('payload' in message) ||
    typeof message.payload !== 'object' ||
    !message.payload
  ) {
    return false
  }
  const payload = message.payload as Partial<WebsiteLoginRevealMessage['payload']>
  return (
    typeof payload.origin === 'string' &&
    payload.origin.length > 0 &&
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    typeof payload.secretId === 'string' &&
    payload.secretId.length > 0
  )
}
