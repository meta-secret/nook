export type WebsiteLoginSaveDecision =
  | 'create'
  | 'update'
  | 'already-saved'
  | 'invalid'

export type WebsiteLoginSaveOfferView = {
  offerId: string
  decision: 'create' | 'update'
  vaultStoreId: string
  vaultName: string
}

export type WebsiteLoginSaveOfferMessage = {
  type: 'nook:website-login-save-offer'
  payload: {
    origin: string
    username: string
    password: string
  }
}

export type WebsiteLoginSavePendingMessage = {
  type: 'nook:website-login-save-pending'
  payload: {
    origin: string
  }
}

export type WebsiteLoginSaveCommitMessage = {
  type: 'nook:website-login-save-commit'
  payload: {
    origin: string
    offerId: string
  }
}

export type WebsiteLoginSaveDismissMessage = {
  type: 'nook:website-login-save-dismiss'
  payload: {
    origin: string
    offerId: string
  }
}

function hasOriginPayload(
  message: unknown,
  type: string,
): message is { type: string; payload: Record<string, unknown> & { origin: string } } {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === type &&
      'payload' in message &&
      typeof message.payload === 'object' &&
      message.payload &&
      'origin' in message.payload &&
      typeof message.payload.origin === 'string' &&
      message.payload.origin.length > 0,
  )
}

export function isWebsiteLoginSaveOfferMessage(
  message: unknown,
): message is WebsiteLoginSaveOfferMessage {
  if (!hasOriginPayload(message, 'nook:website-login-save-offer')) {
    return false
  }
  const payload = message.payload
  return (
    typeof payload.username === 'string' &&
    payload.username.trim().length > 0 &&
    typeof payload.password === 'string' &&
    payload.password.length > 0
  )
}

export function isWebsiteLoginSavePendingMessage(
  message: unknown,
): message is WebsiteLoginSavePendingMessage {
  return hasOriginPayload(message, 'nook:website-login-save-pending')
}

export function isWebsiteLoginSaveCommitMessage(
  message: unknown,
): message is WebsiteLoginSaveCommitMessage {
  if (!hasOriginPayload(message, 'nook:website-login-save-commit')) {
    return false
  }
  return (
    typeof message.payload.offerId === 'string' &&
    message.payload.offerId.length > 0
  )
}

export function isWebsiteLoginSaveDismissMessage(
  message: unknown,
): message is WebsiteLoginSaveDismissMessage {
  if (!hasOriginPayload(message, 'nook:website-login-save-dismiss')) {
    return false
  }
  return (
    typeof message.payload.offerId === 'string' &&
    message.payload.offerId.length > 0
  )
}
