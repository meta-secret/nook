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
    return Schema.decodeUnknown(AuthenticationOutcomeObservationViewSchema)(
      value,
    )
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

type LoginSaveOriginSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
}
const loginSaveOriginSchemaFields: LoginSaveOriginSchemaFields = {
  origin: loginSaveNonEmptyStringSchema,
}

const loginSaveOriginSchema = Schema.Struct(loginSaveOriginSchemaFields)

type WebsiteLoginSaveOfferMessagePayloadSchemaFields = {
  username: Schema.filter<typeof Schema.String>
  password: Schema.filter<typeof Schema.String>
  origin: Schema.filter<typeof Schema.String>
}
const websiteLoginSaveOfferMessagePayloadSchemaFields: WebsiteLoginSaveOfferMessagePayloadSchemaFields =
  {
    ...loginSaveOriginSchema.fields,
    username: Schema.String.pipe(
      Schema.filter((username) => username.trim().length > 0),
    ),
    password: loginSaveNonEmptyStringSchema,
  }

type WebsiteLoginSaveOfferMessageSchemaFields = {
  type: Schema.Literal<[WebsiteLoginSaveOfferMessageType]>
  payload: Schema.Struct<{
    username: Schema.filter<typeof Schema.String>
    password: Schema.filter<typeof Schema.String>
    origin: Schema.filter<typeof Schema.String>
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
) satisfies Schema.Schema<WebsiteLoginSaveOfferMessage>

type WebsiteLoginSavePendingMessageSchemaFields = {
  type: Schema.Literal<[WebsiteLoginSavePendingMessageType]>
  payload: Schema.Struct<{ origin: Schema.filter<typeof Schema.String> }>
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
) satisfies Schema.Schema<WebsiteLoginSavePendingMessage>

type WebsiteLoginSaveCommitMessagePayloadSchemaFields = {
  offerId: Schema.filter<typeof Schema.String>
  evidence: typeof AuthenticationOutcomeObservationViewSchema
  origin: Schema.filter<typeof Schema.String>
}
const websiteLoginSaveCommitMessagePayloadSchemaFields: WebsiteLoginSaveCommitMessagePayloadSchemaFields =
  {
    ...loginSaveOriginSchema.fields,
    offerId: loginSaveNonEmptyStringSchema,
    evidence: AuthenticationOutcomeObservationViewSchema,
  }

type WebsiteLoginSaveCommitMessageSchemaFields = {
  type: Schema.Literal<[WebsiteLoginSaveCommitMessageType]>
  payload: Schema.Struct<{
    offerId: Schema.filter<typeof Schema.String>
    evidence: typeof AuthenticationOutcomeObservationViewSchema
    origin: Schema.filter<typeof Schema.String>
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
) satisfies Schema.Schema<WebsiteLoginSaveCommitMessage>

type WebsiteLoginSaveDismissMessagePayloadSchemaFields = {
  offerId: Schema.filter<typeof Schema.String>
  origin: Schema.filter<typeof Schema.String>
}
const websiteLoginSaveDismissMessagePayloadSchemaFields: WebsiteLoginSaveDismissMessagePayloadSchemaFields =
  {
    ...loginSaveOriginSchema.fields,
    offerId: loginSaveNonEmptyStringSchema,
  }

type WebsiteLoginSaveDismissMessageSchemaFields = {
  type: Schema.Literal<[WebsiteLoginSaveDismissMessageType]>
  payload: Schema.Struct<{
    offerId: Schema.filter<typeof Schema.String>
    origin: Schema.filter<typeof Schema.String>
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
) satisfies Schema.Schema<WebsiteLoginSaveDismissMessage>
