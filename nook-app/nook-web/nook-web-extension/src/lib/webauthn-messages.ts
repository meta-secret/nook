import type { ExternalValue } from './external-value'
export enum WebsitePasskeyCeremony {
  Create = 'create',
  Get = 'get',
}

export enum WebsitePasskeyOptionsMessageType {
  NookWebsitePasskeyOptions = 'nook:website-passkey-options',
}

export type WebsitePasskeyOptionsMessage = {
  type: WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions
  payload: {
    requestId: string
    ceremony: WebsitePasskeyCeremony
    requestJson: string
    expiresAt: number
  }
}

export enum WebsitePasskeyPerformMessageType {
  NookWebsitePasskeyPerform = 'nook:website-passkey-perform',
}

export type WebsitePasskeyPerformMessage = {
  type: WebsitePasskeyPerformMessageType.NookWebsitePasskeyPerform
  payload: WebsitePasskeyOptionsMessage['payload'] & {
    vaultStoreId: string
    credentialId?: string
  }
}

export enum WebsitePasskeyCancelMessageType {
  NookWebsitePasskeyCancel = 'nook:website-passkey-cancel',
}

export type WebsitePasskeyCancelMessage = {
  type: WebsitePasskeyCancelMessageType.NookWebsitePasskeyCancel
  payload: {
    requestId: string
  }
}

function validBase(message: ExternalValue): message is {
  payload: WebsitePasskeyOptionsMessage['payload']
} {
  if (!message || typeof message !== 'object' || !('payload' in message)) {
    return false
  }
  const payload = message.payload
  return (
    !!payload &&
    typeof payload === 'object' &&
    'requestId' in payload &&
    typeof payload.requestId === 'string' &&
    payload.requestId.length >= 16 &&
    payload.requestId.length <= 128 &&
    'ceremony' in payload &&
    (payload.ceremony === WebsitePasskeyCeremony.Create ||
      payload.ceremony === WebsitePasskeyCeremony.Get) &&
    'requestJson' in payload &&
    typeof payload.requestJson === 'string' &&
    payload.requestJson.length > 0 &&
    payload.requestJson.length <= 65_536 &&
    'expiresAt' in payload &&
    typeof payload.expiresAt === 'number' &&
    Number.isFinite(payload.expiresAt) &&
    payload.expiresAt > Date.now()
  )
}

export function isWebsitePasskeyOptionsMessage(
  message: ExternalValue,
): message is WebsitePasskeyOptionsMessage {
  return (
    validBase(message) &&
    'type' in message &&
    message.type === WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions
  )
}

export function isWebsitePasskeyPerformMessage(
  message: ExternalValue,
): message is WebsitePasskeyPerformMessage {
  return (
    validBase(message) &&
    'type' in message &&
    message.type ===
      WebsitePasskeyPerformMessageType.NookWebsitePasskeyPerform &&
    'vaultStoreId' in message.payload &&
    typeof message.payload.vaultStoreId === 'string' &&
    message.payload.vaultStoreId.length > 0 &&
    (!('credentialId' in message.payload) ||
      typeof message.payload.credentialId === 'string')
  )
}

export function isWebsitePasskeyCancelMessage(
  message: ExternalValue,
): message is WebsitePasskeyCancelMessage {
  return Boolean(
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === WebsitePasskeyCancelMessageType.NookWebsitePasskeyCancel &&
    'payload' in message &&
    message.payload &&
    typeof message.payload === 'object' &&
    'requestId' in message.payload &&
    typeof message.payload.requestId === 'string' &&
    message.payload.requestId.length >= 16 &&
    message.payload.requestId.length <= 128,
  )
}

export enum WebsitePasskeyRequestParseKind {
  Parsed = 'parsed',
  Rejected = 'rejected',
}

export type WebsitePasskeyRequestParse =
  | {
      kind: WebsitePasskeyRequestParseKind.Parsed
      request: Record<string, ExternalValue>
    }
  | { kind: WebsitePasskeyRequestParseKind.Rejected }

export function parsedWebsitePasskeyRequest(
  requestJson: string,
): WebsitePasskeyRequestParse {
  try {
    const parsed = JSON.parse(requestJson)
    return parsed && typeof parsed === 'object'
      ? {
          kind: WebsitePasskeyRequestParseKind.Parsed,
          request: parsed as Record<string, ExternalValue>,
        }
      : { kind: WebsitePasskeyRequestParseKind.Rejected }
  } catch {
    return { kind: WebsitePasskeyRequestParseKind.Rejected }
  }
}
