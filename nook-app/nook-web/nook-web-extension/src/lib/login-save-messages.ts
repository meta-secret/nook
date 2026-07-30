import type { AuthenticationOutcomeObservationView } from './outcome-evidence-messages'
import { NookWebsiteLoginSaveDecision } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

export { NookWebsiteLoginSaveDecision }

export type WebsiteLoginSaveOfferView = {
  offerId: string
  decision:
    | NookWebsiteLoginSaveDecision.Create
    | NookWebsiteLoginSaveDecision.Update
  vaultStoreId: string
  vaultName: string
}

export enum WebsiteLoginSavePendingState {
  Unavailable = 'unavailable',
  Available = 'available',
}

export type WebsiteLoginSavePendingResponse =
  | { ok: true; state: WebsiteLoginSavePendingState.Unavailable }
  | {
      ok: true
      state: WebsiteLoginSavePendingState.Available
      offer: WebsiteLoginSaveOfferView
    }
  | { ok: false; reason: string }

export enum WebsiteLoginSaveOfferMessageType {
  NookWebsiteLoginSaveOffer = 'nook:website-login-save-offer',
}

export type WebsiteLoginSaveOfferMessage = {
  type: WebsiteLoginSaveOfferMessageType.NookWebsiteLoginSaveOffer
  payload: {
    origin: string
    username: string
    password: string
  }
}

export enum WebsiteLoginSavePendingMessageType {
  NookWebsiteLoginSavePending = 'nook:website-login-save-pending',
}

export type WebsiteLoginSavePendingMessage = {
  type: WebsiteLoginSavePendingMessageType.NookWebsiteLoginSavePending
  payload: {
    origin: string
  }
}

export enum WebsiteLoginSaveCommitMessageType {
  NookWebsiteLoginSaveCommit = 'nook:website-login-save-commit',
}

export type WebsiteLoginSaveCommitMessage = {
  type: WebsiteLoginSaveCommitMessageType.NookWebsiteLoginSaveCommit
  payload: {
    origin: string
    offerId: string
    evidence: AuthenticationOutcomeObservationView
  }
}

export enum WebsiteLoginSaveDismissMessageType {
  NookWebsiteLoginSaveDismiss = 'nook:website-login-save-dismiss',
}

export type WebsiteLoginSaveDismissMessage = {
  type: WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss
  payload: {
    origin: string
    offerId: string
  }
}

function hasOriginPayload(
  message: unknown,
  type: string,
): message is {
  type: string
  payload: Record<string, unknown> & { origin: string }
} {
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

function isOutcomeObservation(
  value: unknown,
): value is AuthenticationOutcomeObservationView {
  if (!value || typeof value !== 'object') return false
  const view = value as Record<string, unknown>
  return (
    typeof view.navigatedAwayFromAuthPath === 'boolean' &&
    typeof view.authFieldsPresent === 'boolean' &&
    typeof view.successMarkerPresent === 'boolean' &&
    typeof view.errorMarkerPresent === 'boolean' &&
    typeof view.sameDocumentMutation === 'boolean' &&
    typeof view.inIframe === 'boolean' &&
    typeof view.elapsedMs === 'number' &&
    Number.isFinite(view.elapsedMs) &&
    view.elapsedMs >= 0
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
    message.payload.offerId.length > 0 &&
    isOutcomeObservation(message.payload.evidence)
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
