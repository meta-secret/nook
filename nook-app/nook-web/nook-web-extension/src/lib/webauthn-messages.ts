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

export type WebsitePasskeyAccount = {
  credentialId: string
  userName: string
  userDisplayName: string
}

export type WebsitePasskeyVaultOption = {
  vaultStoreId: string
  vaultName: string
  account?: WebsitePasskeyAccount
}

export enum WebsitePasskeyOptionsStatus {
  Unavailable = 'unavailable',
  Locked = 'locked',
  Ready = 'ready',
}

export type WebsitePasskeyOptionsResponse =
  | { ok: false; reason: string }
  | {
      ok: true
      status: WebsitePasskeyOptionsStatus
      options: WebsitePasskeyVaultOption[]
    }

export type WebsitePasskeyRegistrationResponse = {
  ok: true
  credentialId: string
  clientDataJSON: string
  attestationObject: string
  transports: string[]
}

export type WebsitePasskeyAssertionResponse = {
  ok: true
  credentialId: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  userHandle: string
}

export type WebsitePasskeyPerformResponse =
  | { ok: false; reason: string }
  | WebsitePasskeyRegistrationResponse
  | WebsitePasskeyAssertionResponse

function validBase(message: object): message is {
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
  message: object,
): message is WebsitePasskeyOptionsMessage {
  return (
    validBase(message) &&
    'type' in message &&
    message.type === WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions
  )
}

export function isWebsitePasskeyPerformMessage(
  message: object,
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
      (typeof message.payload.credentialId === 'string' &&
        message.payload.credentialId.length > 0))
  )
}

export function isWebsitePasskeyCancelMessage(
  message: object,
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

type WebsitePasskeyCreateRequestCandidate = {
  origin?: string
  relyingParty?: { id?: string }
}

type WebsitePasskeyGetRequestCandidate = {
  origin?: string
  rpId?: string
  allowCredentials?: { id: string }[]
}

export function parsedWebsitePasskeyRequest(
  args: ParseWebsitePasskeyRequestArgs,
): WebsitePasskeyRequestParse {
  try {
    const parsed = JSON.parse(args.requestJson) as
      WebsitePasskeyCreateRequestCandidate | WebsitePasskeyGetRequestCandidate
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
  credentialSelection: WebsitePasskeyCredentialSelection
}

export enum WebsitePasskeyCredentialSelectionKind {
  RequestDefaults = 'request-defaults',
  Selected = 'selected',
}

export type WebsitePasskeyCredentialSelection =
  | { kind: WebsitePasskeyCredentialSelectionKind.RequestDefaults }
  | {
      kind: WebsitePasskeyCredentialSelectionKind.Selected
      credentialId: string
    }

export function websitePasskeyRequestJson(
  args: WebsitePasskeyRequestJsonArgs,
): string {
  if (
    args.request.ceremony !== WebsitePasskeyCeremony.Get ||
    args.credentialSelection.kind ===
      WebsitePasskeyCredentialSelectionKind.RequestDefaults
  ) {
    return args.request.requestJson
  }
  if (args.credentialSelection.credentialId.length === 0) {
    throw new Error('Selected passkey credential ID must not be empty.')
  }
  const parsed = JSON.parse(
    args.request.requestJson,
  ) as WebsitePasskeyGetRequestCandidate
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Validated passkey request could not be reconstructed.')
  }
  const descriptor: PropertyDescriptor = {
    value: [{ id: args.credentialSelection.credentialId }],
    enumerable: true,
    configurable: true,
    writable: true,
  }
  Object.defineProperty(parsed, 'allowCredentials', descriptor)
  return JSON.stringify(parsed)
}
