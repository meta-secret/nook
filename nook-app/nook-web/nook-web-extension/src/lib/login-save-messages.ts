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
    const { payload } = message

    return (
      'username' in payload &&
      typeof payload.username === 'string' &&
      payload.username.trim().length > 0 &&
      'password' in payload &&
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
    return (
      'navigatedAwayFromAuthPath' in value &&
      typeof value.navigatedAwayFromAuthPath === 'boolean' &&
      'authFieldsPresent' in value &&
      typeof value.authFieldsPresent === 'boolean' &&
      'successMarkerPresent' in value &&
      typeof value.successMarkerPresent === 'boolean' &&
      'errorMarkerPresent' in value &&
      typeof value.errorMarkerPresent === 'boolean' &&
      'sameDocumentMutation' in value &&
      typeof value.sameDocumentMutation === 'boolean' &&
      'inIframe' in value &&
      typeof value.inIframe === 'boolean' &&
      'elapsedMs' in value &&
      typeof value.elapsedMs === 'number' &&
      Number.isFinite(value.elapsedMs) &&
      value.elapsedMs >= 0
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
    const { payload } = message

    return (
      'offerId' in payload &&
      typeof payload.offerId === 'string' &&
      payload.offerId.length > 0 &&
      'evidence' in payload &&
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
    const { payload } = message

    return (
      'offerId' in payload &&
      typeof payload.offerId === 'string' &&
      payload.offerId.length > 0
    )
  }
}
