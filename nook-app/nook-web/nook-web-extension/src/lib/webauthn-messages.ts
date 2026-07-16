export type WebsitePasskeyCeremony = 'create' | 'get'

export type WebsitePasskeyOptionsMessage = {
  type: 'nook:website-passkey-options'
  payload: {
    requestId: string
    ceremony: WebsitePasskeyCeremony
    requestJson: string
  }
}

export type WebsitePasskeyPerformMessage = {
  type: 'nook:website-passkey-perform'
  payload: WebsitePasskeyOptionsMessage['payload'] & {
    vaultStoreId: string
    credentialId?: string
  }
}

function validBase(message: unknown): message is {
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
    (payload.ceremony === 'create' || payload.ceremony === 'get') &&
    'requestJson' in payload &&
    typeof payload.requestJson === 'string' &&
    payload.requestJson.length > 0 &&
    payload.requestJson.length <= 65_536
  )
}

export function isWebsitePasskeyOptionsMessage(
  message: unknown,
): message is WebsitePasskeyOptionsMessage {
  return (
    validBase(message) &&
    'type' in message &&
    message.type === 'nook:website-passkey-options'
  )
}

export function isWebsitePasskeyPerformMessage(
  message: unknown,
): message is WebsitePasskeyPerformMessage {
  return (
    validBase(message) &&
    'type' in message &&
    message.type === 'nook:website-passkey-perform' &&
    'vaultStoreId' in message.payload &&
    typeof message.payload.vaultStoreId === 'string' &&
    message.payload.vaultStoreId.length > 0 &&
    (!('credentialId' in message.payload) ||
      message.payload.credentialId === undefined ||
      typeof message.payload.credentialId === 'string')
  )
}

export function parsedWebsitePasskeyRequest(
  requestJson: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(requestJson)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}
