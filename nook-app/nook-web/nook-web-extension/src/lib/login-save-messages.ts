import { Schema } from 'effect'

import {
  AuthenticationOutcomeObservationViewSchema,
  type AuthenticationOutcomeObservationView,
} from './outcome-evidence-messages'

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
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteLoginSaveOfferMessageSchema)(message)
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
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteLoginSavePendingMessageSchema)(message)
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
  static decodeOutcomeObservation(value: unknown) {
    return Schema.decodeUnknown(AuthenticationOutcomeObservationViewSchema)(value)
  }

  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteLoginSaveCommitMessageSchema)(message)
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
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteLoginSaveDismissMessageSchema)(message)
  }
}

const loginSaveNonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

const loginSaveOriginSchema = Schema.Struct({
  origin: loginSaveNonEmptyStringSchema,
})

const websiteLoginSaveOfferMessageSchema = Schema.Struct({
  type: Schema.Literal(WebsiteLoginSaveOfferMessageType.NookWebsiteLoginSaveOffer),
  payload: Schema.Struct({
    ...loginSaveOriginSchema.fields,
    username: Schema.String.pipe(
      Schema.filter((username) => username.trim().length > 0),
    ),
    password: loginSaveNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<WebsiteLoginSaveOfferMessage>

const websiteLoginSavePendingMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteLoginSavePendingMessageType.NookWebsiteLoginSavePending,
  ),
  payload: loginSaveOriginSchema,
}) satisfies Schema.Schema<WebsiteLoginSavePendingMessage>

const websiteLoginSaveCommitMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteLoginSaveCommitMessageType.NookWebsiteLoginSaveCommit,
  ),
  payload: Schema.Struct({
    ...loginSaveOriginSchema.fields,
    offerId: loginSaveNonEmptyStringSchema,
    evidence: AuthenticationOutcomeObservationViewSchema,
  }),
}) satisfies Schema.Schema<WebsiteLoginSaveCommitMessage>

const websiteLoginSaveDismissMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss,
  ),
  payload: Schema.Struct({
    ...loginSaveOriginSchema.fields,
    offerId: loginSaveNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<WebsiteLoginSaveDismissMessage>
