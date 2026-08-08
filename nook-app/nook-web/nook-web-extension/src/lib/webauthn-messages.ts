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
      request: WebsitePasskeyRequest
    }
  | { kind: WebsitePasskeyRequestParseKind.Rejected }

export type WebsitePasskeyRequest =
  | {
      ceremony: WebsitePasskeyCeremony.Create
      origin: string
      rpId: string
      requestJson: string
    }
  | {
      ceremony: WebsitePasskeyCeremony.Get
      origin: string
      rpId: string
      requestJson: string
    }

export type ParseWebsitePasskeyRequestArgs = {
  ceremony: WebsitePasskeyCeremony
  requestJson: string
}

export function parsedWebsitePasskeyRequest(
  args: ParseWebsitePasskeyRequestArgs,
): WebsitePasskeyRequestParse {
  try {
    const parsed = JSON.parse(args.requestJson) as ExternalValue
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !('origin' in parsed) ||
      typeof parsed.origin !== 'string'
    ) {
      return { kind: WebsitePasskeyRequestParseKind.Rejected }
    }
    if (args.ceremony === WebsitePasskeyCeremony.Get) {
      return 'rpId' in parsed && typeof parsed.rpId === 'string'
        ? {
            kind: WebsitePasskeyRequestParseKind.Parsed,
            request: {
              ceremony: WebsitePasskeyCeremony.Get,
              origin: parsed.origin,
              rpId: parsed.rpId,
              requestJson: args.requestJson,
            },
          }
        : { kind: WebsitePasskeyRequestParseKind.Rejected }
    }
    const relyingParty = 'relyingParty' in parsed ? parsed.relyingParty : false
    return relyingParty &&
      typeof relyingParty === 'object' &&
      !Array.isArray(relyingParty) &&
      'id' in relyingParty &&
      typeof relyingParty.id === 'string'
      ? {
          kind: WebsitePasskeyRequestParseKind.Parsed,
          request: {
            ceremony: WebsitePasskeyCeremony.Create,
            origin: parsed.origin,
            rpId: relyingParty.id,
            requestJson: args.requestJson,
          },
        }
      : { kind: WebsitePasskeyRequestParseKind.Rejected }
  } catch {
    return { kind: WebsitePasskeyRequestParseKind.Rejected }
  }
}

export type WebsitePasskeyRequestJsonArgs = {
  request: WebsitePasskeyRequest
  credentialId?: string
}

export function websitePasskeyRequestJson(
  args: WebsitePasskeyRequestJsonArgs,
): string {
  if (
    args.request.ceremony !== WebsitePasskeyCeremony.Get ||
    !args.credentialId
  ) {
    return args.request.requestJson
  }
  const parsed: ExternalValue = JSON.parse(args.request.requestJson)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Validated passkey request could not be reconstructed.')
  }
  const descriptor: PropertyDescriptor = {
    value: [{ id: args.credentialId }],
    enumerable: true,
    configurable: true,
    writable: true,
  }
  Object.defineProperty(parsed, 'allowCredentials', descriptor)
  return JSON.stringify(parsed)
}
