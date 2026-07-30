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
  message: unknown,
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
  const payload = message.payload as Record<string, unknown>
  return typeof payload.origin === 'string' && payload.origin.length > 0
}

export function isWebsiteAuthenticatorOptionsMessage(
  message: unknown,
): message is WebsiteAuthenticatorOptionsMessage {
  return hasOriginPayload(message, 'nook:website-authenticator-options')
}

export function isWebsiteAuthenticatorFillMessage(
  message: unknown,
): message is WebsiteAuthenticatorFillMessage {
  if (!hasOriginPayload(message, 'nook:website-authenticator-fill')) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    typeof payload.secretId === 'string' &&
    payload.secretId.length > 0
  )
}

export function isWebsiteLoginRevealMessage(
  message: unknown,
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
  const payload = message.payload as Record<string, unknown>
  return (
    typeof payload.origin === 'string' &&
    payload.origin.length > 0 &&
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    typeof payload.secretId === 'string' &&
    payload.secretId.length > 0
  )
}
