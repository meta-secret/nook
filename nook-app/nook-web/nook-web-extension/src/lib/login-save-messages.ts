import { Schema } from 'effect'
import { LoginSaveObservationCodecs } from './login-save-observation-codecs'
import type { LoginSubmissionCapture, LoginSaveCommitEvidence } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
const loginSaveObservationCodecs = new LoginSaveObservationCodecs()

import {
  AuthenticationOutcomeObservationViewSchema,
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
    capture: LoginSubmissionCapture
    capturedValues: string[]
  }
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(websiteLoginSaveOfferMessageSchema)(
      message,
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
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(websiteLoginSavePendingMessageSchema)(
      message,
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
    evidence: LoginSaveCommitEvidence
  }
  static decodeOutcomeObservation(value: unknown) {
    return Schema.decodeUnknownEffect(
      AuthenticationOutcomeObservationViewSchema,
    )(value)
  }

  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(websiteLoginSaveCommitMessageSchema)(
      message,
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
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(websiteLoginSaveDismissMessageSchema)(
      message,
    )
  }
}

const loginSaveNonEmptyStringSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
)

type LoginSaveOriginSchemaFields = {
  origin: typeof Schema.String
}
const loginSaveOriginSchemaFields: LoginSaveOriginSchemaFields = {
  origin: loginSaveNonEmptyStringSchema,
}

const loginSaveOriginSchema = Schema.Struct(loginSaveOriginSchemaFields)

type WebsiteLoginSaveOfferMessagePayloadSchemaFields = {
  username: typeof Schema.String
  password: typeof Schema.String
  capture: typeof loginSaveObservationCodecs.capture
  capturedValues: Schema.Codec<string[]>
  origin: typeof Schema.String
}
const websiteLoginSaveOfferMessagePayloadSchemaFields: WebsiteLoginSaveOfferMessagePayloadSchemaFields =
  {
    ...loginSaveOriginSchema.fields,
    username: Schema.String,
    password: Schema.String,
    capture: loginSaveObservationCodecs.capture,
    capturedValues: Schema.mutable(Schema.Array(Schema.String)),
  }

type WebsiteLoginSaveOfferMessageSchemaFields = {
  type: Schema.Literal<WebsiteLoginSaveOfferMessageType>
  payload: Schema.Struct<{
    username: typeof Schema.String
    password: typeof Schema.String
  capture: typeof loginSaveObservationCodecs.capture
  capturedValues: Schema.Codec<string[]>
    origin: typeof Schema.String
  }>
}
const websiteLoginSaveOfferMessageSchemaFields: WebsiteLoginSaveOfferMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteLoginSaveOfferMessageType.NookWebsiteLoginSaveOffer,
    ),
    payload: Schema.Struct(websiteLoginSaveOfferMessagePayloadSchemaFields),
  }

const websiteLoginSaveOfferMessageSchema = Schema.Struct(
  websiteLoginSaveOfferMessageSchemaFields,
) satisfies Schema.Codec<WebsiteLoginSaveOfferMessage>

type WebsiteLoginSavePendingMessageSchemaFields = {
  type: Schema.Literal<WebsiteLoginSavePendingMessageType>
  payload: Schema.Struct<{ origin: typeof Schema.String }>
}
const websiteLoginSavePendingMessageSchemaFields: WebsiteLoginSavePendingMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteLoginSavePendingMessageType.NookWebsiteLoginSavePending,
    ),
    payload: loginSaveOriginSchema,
  }

const websiteLoginSavePendingMessageSchema = Schema.Struct(
  websiteLoginSavePendingMessageSchemaFields,
) satisfies Schema.Codec<WebsiteLoginSavePendingMessage>

type WebsiteLoginSaveCommitMessagePayloadSchemaFields = {
  offerId: typeof Schema.String
  evidence: typeof loginSaveObservationCodecs.evidence
  origin: typeof Schema.String
}
const websiteLoginSaveCommitMessagePayloadSchemaFields: WebsiteLoginSaveCommitMessagePayloadSchemaFields =
  {
    ...loginSaveOriginSchema.fields,
    offerId: loginSaveNonEmptyStringSchema,
    evidence: loginSaveObservationCodecs.evidence,
  }

type WebsiteLoginSaveCommitMessageSchemaFields = {
  type: Schema.Literal<WebsiteLoginSaveCommitMessageType>
  payload: Schema.Struct<{
    offerId: typeof Schema.String
    evidence: typeof loginSaveObservationCodecs.evidence
    origin: typeof Schema.String
  }>
}
const websiteLoginSaveCommitMessageSchemaFields: WebsiteLoginSaveCommitMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteLoginSaveCommitMessageType.NookWebsiteLoginSaveCommit,
    ),
    payload: Schema.Struct(websiteLoginSaveCommitMessagePayloadSchemaFields),
  }

const websiteLoginSaveCommitMessageSchema = Schema.Struct(
  websiteLoginSaveCommitMessageSchemaFields,
) satisfies Schema.Codec<WebsiteLoginSaveCommitMessage>

type WebsiteLoginSaveDismissMessagePayloadSchemaFields = {
  offerId: typeof Schema.String
  origin: typeof Schema.String
}
const websiteLoginSaveDismissMessagePayloadSchemaFields: WebsiteLoginSaveDismissMessagePayloadSchemaFields =
  {
    ...loginSaveOriginSchema.fields,
    offerId: loginSaveNonEmptyStringSchema,
  }

type WebsiteLoginSaveDismissMessageSchemaFields = {
  type: Schema.Literal<WebsiteLoginSaveDismissMessageType>
  payload: Schema.Struct<{
    offerId: typeof Schema.String
    origin: typeof Schema.String
  }>
}
const websiteLoginSaveDismissMessageSchemaFields: WebsiteLoginSaveDismissMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss,
    ),
    payload: Schema.Struct(websiteLoginSaveDismissMessagePayloadSchemaFields),
  }

const websiteLoginSaveDismissMessageSchema = Schema.Struct(
  websiteLoginSaveDismissMessageSchemaFields,
) satisfies Schema.Codec<WebsiteLoginSaveDismissMessage>
