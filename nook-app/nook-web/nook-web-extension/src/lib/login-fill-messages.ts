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

export type WebsiteLoginOptionsMessage = {
  type: 'nook:website-login-options'
  payload: {
    origin: string
  }
}

export type WebsiteLoginRevealMessage = {
  type: 'nook:website-login-fill'
  payload: {
    origin: string
    vaultStoreId: string
    secretId: string
  }
}

export type WebsiteAuthenticatorOptionsMessage = {
  type: 'nook:website-authenticator-options'
  payload: {
    origin: string
  }
}

export type WebsiteAuthenticatorFillMessage = {
  type: 'nook:website-authenticator-fill'
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
    message.type !== 'nook:website-login-options' ||
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
    message.type !== 'nook:website-login-fill' ||
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
