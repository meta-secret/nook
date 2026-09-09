import type { AuthenticationOutcomeObservationView } from './outcome-evidence-messages'

import { OriginRuntimeMessage as OriginRuntimeMessageSchema } from './origin-runtime-message'

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

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginSaveOfferMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginSaveOfferMessageType.NookWebsiteLoginSaveOffer
  declare readonly payload: {
    origin: string
    username: string
    password: string
  }
  static is(message: unknown): message is WebsiteLoginSaveOfferMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteLoginSaveOfferMessageType.NookWebsiteLoginSaveOffer
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
}

export enum WebsiteLoginSavePendingMessageType {
  NookWebsiteLoginSavePending = 'nook:website-login-save-pending',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginSavePendingMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginSavePendingMessageType.NookWebsiteLoginSavePending
  declare readonly payload: {
    origin: string
  }
  static is(message: unknown): message is WebsiteLoginSavePendingMessage {
    return (
      OriginRuntimeMessageSchema.is(message) &&
      message.type ===
        WebsiteLoginSavePendingMessageType.NookWebsiteLoginSavePending
    )
  }
}

export enum WebsiteLoginSaveCommitMessageType {
  NookWebsiteLoginSaveCommit = 'nook:website-login-save-commit',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginSaveCommitMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginSaveCommitMessageType.NookWebsiteLoginSaveCommit
  declare readonly payload: {
    origin: string
    offerId: string
    evidence: AuthenticationOutcomeObservationView
  }
  static isOutcomeObservation(
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

  static is(message: unknown): message is WebsiteLoginSaveCommitMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteLoginSaveCommitMessageType.NookWebsiteLoginSaveCommit
    ) {
      return false
    }
    const payload = message.payload as WebsiteLoginSaveCommitMessage['payload']

    return (
      typeof payload.offerId === 'string' &&
      payload.offerId.length > 0 &&
      WebsiteLoginSaveCommitMessage.isOutcomeObservation(payload.evidence)
    )
  }
}

export enum WebsiteLoginSaveDismissMessageType {
  NookWebsiteLoginSaveDismiss = 'nook:website-login-save-dismiss',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginSaveDismissMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss
  declare readonly payload: {
    origin: string
    offerId: string
  }
  static is(message: unknown): message is WebsiteLoginSaveDismissMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss
    ) {
      return false
    }
    const payload = message.payload as WebsiteLoginSaveDismissMessage['payload']

    return typeof payload.offerId === 'string' && payload.offerId.length > 0
  }
}
