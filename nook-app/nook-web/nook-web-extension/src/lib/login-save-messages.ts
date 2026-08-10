import type { AuthenticationOutcomeObservationView } from './outcome-evidence-messages'
import { hasOriginPayload } from './origin-runtime-message'
import { NookWebsiteLoginSaveDecision } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

export { NookWebsiteLoginSaveDecision }

export type WebsiteLoginSaveOfferView = {
  offerId: string
  decision:
    NookWebsiteLoginSaveDecision.Create | NookWebsiteLoginSaveDecision.Update
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

export type WebsiteLoginSaveOfferResponse =
  { ok: true; offer: WebsiteLoginSaveOfferView } | { ok: true } | { ok: false }

export type WebsiteLoginSaveActionResponse =
  { ok: true } | { ok: false; reason?: string }

function isWebsiteLoginSaveOfferView(
  offer: object,
): offer is WebsiteLoginSaveOfferView {
  return (
    'offerId' in offer &&
    typeof offer.offerId === 'string' &&
    offer.offerId.length > 0 &&
    'decision' in offer &&
    (offer.decision === NookWebsiteLoginSaveDecision.Create ||
      offer.decision === NookWebsiteLoginSaveDecision.Update) &&
    'vaultStoreId' in offer &&
    typeof offer.vaultStoreId === 'string' &&
    offer.vaultStoreId.length > 0 &&
    'vaultName' in offer &&
    typeof offer.vaultName === 'string'
  )
}

export function isWebsiteLoginSaveOfferResponse(
  response: object,
): response is WebsiteLoginSaveOfferResponse {
  if (!('ok' in response) || typeof response.ok !== 'boolean') return false
  if (response.ok === false || !('offer' in response)) return true
  return Boolean(
    response.offer &&
    typeof response.offer === 'object' &&
    isWebsiteLoginSaveOfferView(response.offer),
  )
}

export function isWebsiteLoginSavePendingResponse(
  response: object,
): response is WebsiteLoginSavePendingResponse {
  if (!('ok' in response) || typeof response.ok !== 'boolean') return false
  if (response.ok === false) {
    return 'reason' in response && typeof response.reason === 'string'
  }
  if (!('state' in response)) return false
  if (response.state === WebsiteLoginSavePendingState.Unavailable) {
    return !('offer' in response)
  }
  return (
    response.state === WebsiteLoginSavePendingState.Available &&
    'offer' in response &&
    Boolean(
      response.offer &&
      typeof response.offer === 'object' &&
      isWebsiteLoginSaveOfferView(response.offer),
    )
  )
}

export function isWebsiteLoginSaveActionResponse(
  response: object,
): response is WebsiteLoginSaveActionResponse {
  return (
    'ok' in response &&
    typeof response.ok === 'boolean' &&
    (response.ok ||
      !('reason' in response) ||
      typeof response.reason === 'string')
  )
}

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

function isOutcomeObservation(
  value: object,
): value is AuthenticationOutcomeObservationView {
  if (!value || typeof value !== 'object') return false
  const view = value as AuthenticationOutcomeObservationView
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
  message: object,
): message is WebsiteLoginSaveOfferMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !== WebsiteLoginSaveOfferMessageType.NookWebsiteLoginSaveOffer
  ) {
    return false
  }
  const payload = message.payload as WebsiteLoginSaveOfferMessage['payload']

  return (
    typeof payload.username === 'string' &&
    payload.username.trim().length > 0 &&
    typeof payload.password === 'string' &&
    payload.password.length > 0
  )
}

export function isWebsiteLoginSavePendingMessage(
  message: object,
): message is WebsiteLoginSavePendingMessage {
  return (
    hasOriginPayload(message) &&
    message.type ===
      WebsiteLoginSavePendingMessageType.NookWebsiteLoginSavePending
  )
}

export function isWebsiteLoginSaveCommitMessage(
  message: object,
): message is WebsiteLoginSaveCommitMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteLoginSaveCommitMessageType.NookWebsiteLoginSaveCommit
  ) {
    return false
  }
  const payload = message.payload as WebsiteLoginSaveCommitMessage['payload']

  return (
    typeof payload.offerId === 'string' &&
    payload.offerId.length > 0 &&
    isOutcomeObservation(payload.evidence)
  )
}

export function isWebsiteLoginSaveDismissMessage(
  message: object,
): message is WebsiteLoginSaveDismissMessage {
  if (
    !hasOriginPayload(message) ||
    message.type !==
      WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss
  ) {
    return false
  }
  const payload = message.payload as WebsiteLoginSaveDismissMessage['payload']

  return typeof payload.offerId === 'string' && payload.offerId.length > 0
}
