import { hasOriginPayload } from './origin-runtime-message'

export type WebsiteLoginAccountOption = {
  vaultStoreId: string
  vaultName: string
  secretId: string
  username: string
  websiteUrl: string
  websiteHost: string
}

export type WebsiteLoginFillResponse =
  | { ok: true; username: string; password: string }
  | { ok: false; reason: string }

export function isWebsiteLoginFillResponse(
  response: unknown,
): response is WebsiteLoginFillResponse {
  if (!response || typeof response !== 'object') return false
  if (!('ok' in response) || typeof response.ok !== 'boolean') return false
  if (!response.ok) {
    return 'reason' in response && typeof response.reason === 'string'
  }
  return (
    'username' in response &&
    typeof response.username === 'string' &&
    'password' in response &&
    typeof response.password === 'string'
  )
}

export type WebsiteAuthenticatorOption = {
  vaultStoreId: string
  vaultName: string
  secretId: string
  issuer: string
  account: string
}

export enum WebsiteAuthenticatorResponseStatus {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
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
    authorizationGeneration?: number
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
    authorizationGeneration?: number
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
  const payload = message.payload as WebsiteLoginOptionsMessage['payload']

  return typeof payload.origin === 'string' && payload.origin.length > 0
}

export function isWebsiteAuthenticatorOptionsMessage(
  message: unknown,
): message is WebsiteAuthenticatorOptionsMessage {
  return (
    hasOriginPayload(message) &&
    message.type ===
      WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions
  )
}

export function isWebsiteAuthenticatorFillMessage(
  message: unknown,
): message is WebsiteAuthenticatorFillMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill
  ) {
    return false
  }
  const payload = message.payload as WebsiteAuthenticatorFillMessage['payload']

  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    typeof payload.secretId === 'string' &&
    payload.secretId.length > 0 &&
    (payload.authorizationGeneration === undefined ||
      (Number.isInteger(payload.authorizationGeneration) &&
        payload.authorizationGeneration >= 0))
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
  const payload = message.payload as WebsiteLoginRevealMessage['payload']

  return (
    typeof payload.origin === 'string' &&
    payload.origin.length > 0 &&
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    typeof payload.secretId === 'string' &&
    payload.secretId.length > 0 &&
    (payload.authorizationGeneration === undefined ||
      (Number.isInteger(payload.authorizationGeneration) &&
        payload.authorizationGeneration >= 0))
  )
}
