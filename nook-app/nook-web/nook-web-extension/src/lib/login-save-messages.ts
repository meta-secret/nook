import type { AuthenticationOutcomeObservationView } from './outcome-evidence-messages'
import { hasOriginPayload } from './origin-runtime-message'
import { NookWebsiteLoginSaveDecision } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOffer,
  WebsiteLoginSaveOfferResponse,
  WebsiteLoginSavePendingAvailable,
  WebsiteLoginSavePendingResponse,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export { NookWebsiteLoginSaveDecision }

export type WebsiteLoginSaveOfferView = WebsiteLoginSaveOffer
export type {
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOfferResponse,
  WebsiteLoginSavePendingAvailable,
  WebsiteLoginSavePendingResponse,
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
  value: unknown,
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
  message: unknown,
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
  message: unknown,
): message is WebsiteLoginSavePendingMessage {
  return (
    hasOriginPayload(message) &&
    message.type ===
      WebsiteLoginSavePendingMessageType.NookWebsiteLoginSavePending
  )
}

export function isWebsiteLoginSaveCommitMessage(
  message: unknown,
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
  message: unknown,
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
