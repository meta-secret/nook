import { Schema } from 'effect'

import type { WebsiteAuthenticatorOption } from './login-fill-messages'

export const MAX_AUTHENTICATOR_SEARCH_LENGTH = 200

export enum WebsiteAuthenticatorPickerOpenMessageType {
  NookWebsiteAuthenticatorPickerOpen = 'nook:website-authenticator-picker-open',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorPickerOpenMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen
  declare readonly payload: {
    origin: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorPickerOpenMessageSchema)(
      message,
    )
  }
}

export enum AuthenticatorPickerQueryMessageType {
  NookAuthenticatorPickerQuery = 'nook:authenticator-picker-query',
}

/** Owns admission of the concrete browser response returned for one query. */
export class AuthenticatorPickerQueryResponse {
  private constructor() {}
  declare readonly ok: true
  declare readonly origin: string
  declare readonly accounts: WebsiteAuthenticatorOption[]

  static decode(response: unknown) {
    return Schema.decodeUnknown(authenticatorPickerQueryResponseSchema)(
      response,
    )
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticatorPickerQueryMessage {
  private constructor() {}
  declare readonly type: AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery
  declare readonly payload: {
    requestId: string
    query: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(authenticatorPickerQueryMessageSchema)(message)
  }
}

export enum AuthenticatorPickerSelectMessageType {
  NookAuthenticatorPickerSelect = 'nook:authenticator-picker-select',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticatorPickerSelectMessage {
  private constructor() {}
  declare readonly type: AuthenticatorPickerSelectMessageType.NookAuthenticatorPickerSelect
  declare readonly payload: {
    requestId: string
    vaultStoreId: string
    secretId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(authenticatorPickerSelectMessageSchema)(message)
  }
}

/** Structural browser acknowledgement returned after a selected account is delivered. */
export class AuthenticatorPickerSelectResponse {
  private constructor() {}
  declare readonly ok: true

  static decode(response: unknown) {
    return Schema.decodeUnknown(authenticatorPickerSelectResponseSchema)(
      response,
    )
  }
}

export type AuthenticatorPickerRequestMessage =
  AuthenticatorPickerQueryMessage | AuthenticatorPickerSelectMessage

export enum AuthenticatorPickerRuntimeResponseKind {
  Query = 'query',
  Selected = 'selected',
  Rejected = 'rejected',
}

export type AuthenticatorPickerRuntimeResponse =
  | {
      readonly kind: AuthenticatorPickerRuntimeResponseKind.Query
      readonly response: AuthenticatorPickerQueryResponse
    }
  | { readonly kind: AuthenticatorPickerRuntimeResponseKind.Selected }
  | { readonly kind: AuthenticatorPickerRuntimeResponseKind.Rejected }

export enum AuthenticatorPickerCancelMessageType {
  NookAuthenticatorPickerCancel = 'nook:authenticator-picker-cancel',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticatorPickerCancelMessage {
  private constructor() {}
  declare readonly type: AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel
  declare readonly payload: {
    requestId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(authenticatorPickerCancelMessageSchema)(message)
  }
}

export enum WebsiteAuthenticatorSelectedMessageType {
  NookWebsiteAuthenticatorSelected = 'nook:website-authenticator-selected',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorSelectedMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorSelectedMessageType.NookWebsiteAuthenticatorSelected
  declare readonly payload: {
    origin: string
    requestId: string
    account: Pick<WebsiteAuthenticatorOption, 'vaultStoreId' | 'secretId'> & {
      authorizationGeneration: string
    }
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorSelectedMessageSchema)(
      message,
    )
  }
}

export enum WebsiteAuthenticatorCanceledMessageType {
  NookWebsiteAuthenticatorCanceled = 'nook:website-authenticator-canceled',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorCanceledMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled
  declare readonly payload: {
    origin: string
    requestId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorCanceledMessageSchema)(
      message,
    )
  }
}

const authenticatorPickerNonEmptyStringSchema = Schema.String.pipe(
  Schema.minLength(1),
)

type AuthenticatorPickerQueryResponseAccountsSchemaFields = {
  vaultStoreId: Schema.filter<typeof Schema.String>
  secretId: Schema.filter<typeof Schema.String>
  issuer: typeof Schema.String
  account: typeof Schema.String
  vaultName: typeof Schema.String
}
const authenticatorPickerQueryResponseAccountsSchemaFields: AuthenticatorPickerQueryResponseAccountsSchemaFields =
  {
    vaultStoreId: authenticatorPickerNonEmptyStringSchema,
    secretId: authenticatorPickerNonEmptyStringSchema,
    issuer: Schema.String,
    account: Schema.String,
    vaultName: Schema.String,
  }

type AuthenticatorPickerQueryResponseSchemaFields = {
  ok: Schema.Literal<[true]>
  origin: Schema.filter<typeof Schema.String>
  accounts: Schema.mutable<
    Schema.Array$<
      Schema.Struct<{
        vaultStoreId: Schema.filter<typeof Schema.String>
        secretId: Schema.filter<typeof Schema.String>
        issuer: typeof Schema.String
        account: typeof Schema.String
        vaultName: typeof Schema.String
      }>
    >
  >
}
const authenticatorPickerQueryResponseSchemaFields: AuthenticatorPickerQueryResponseSchemaFields =
  {
    ok: Schema.Literal(true),
    origin: authenticatorPickerNonEmptyStringSchema,
    accounts: Schema.mutable(
      Schema.Array(
        Schema.Struct(authenticatorPickerQueryResponseAccountsSchemaFields),
      ),
    ),
  }

const authenticatorPickerQueryResponseSchema = Schema.Struct(
  authenticatorPickerQueryResponseSchemaFields,
) satisfies Schema.Schema<AuthenticatorPickerQueryResponse>

type AuthenticatorPickerSelectResponseSchemaFields = {
  ok: Schema.Literal<[true]>
}
const authenticatorPickerSelectResponseSchemaFields: AuthenticatorPickerSelectResponseSchemaFields =
  {
    ok: Schema.Literal(true),
  }

const authenticatorPickerSelectResponseSchema = Schema.Struct(
  authenticatorPickerSelectResponseSchemaFields,
) satisfies Schema.Schema<AuthenticatorPickerSelectResponse>

type WebsiteAuthenticatorPickerOpenMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorPickerOpenMessagePayloadSchemaFields: WebsiteAuthenticatorPickerOpenMessagePayloadSchemaFields =
  { origin: authenticatorPickerNonEmptyStringSchema }

type WebsiteAuthenticatorPickerOpenMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorPickerOpenMessageType]>
  payload: Schema.Struct<{ origin: Schema.filter<typeof Schema.String> }>
}
const websiteAuthenticatorPickerOpenMessageSchemaFields: WebsiteAuthenticatorPickerOpenMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorPickerOpenMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorPickerOpenMessageSchema = Schema.Struct(
  websiteAuthenticatorPickerOpenMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorPickerOpenMessage>

type AuthenticatorPickerQueryMessagePayloadSchemaFields = {
  requestId: Schema.filter<typeof Schema.String>
  query: Schema.filter<typeof Schema.String>
}
const authenticatorPickerQueryMessagePayloadSchemaFields: AuthenticatorPickerQueryMessagePayloadSchemaFields =
  {
    requestId: authenticatorPickerNonEmptyStringSchema,
    query: Schema.String.pipe(
      Schema.maxLength(MAX_AUTHENTICATOR_SEARCH_LENGTH),
    ),
  }

type AuthenticatorPickerQueryMessageSchemaFields = {
  type: Schema.Literal<[AuthenticatorPickerQueryMessageType]>
  payload: Schema.Struct<{
    requestId: Schema.filter<typeof Schema.String>
    query: Schema.filter<typeof Schema.String>
  }>
}
const authenticatorPickerQueryMessageSchemaFields: AuthenticatorPickerQueryMessageSchemaFields =
  {
    type: Schema.Literal(
      AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery,
    ),
    payload: Schema.Struct(authenticatorPickerQueryMessagePayloadSchemaFields),
  }

const authenticatorPickerQueryMessageSchema = Schema.Struct(
  authenticatorPickerQueryMessageSchemaFields,
) satisfies Schema.Schema<AuthenticatorPickerQueryMessage>

type AuthenticatorPickerSelectMessagePayloadSchemaFields = {
  requestId: Schema.filter<typeof Schema.String>
  vaultStoreId: Schema.filter<typeof Schema.String>
  secretId: Schema.filter<typeof Schema.String>
}
const authenticatorPickerSelectMessagePayloadSchemaFields: AuthenticatorPickerSelectMessagePayloadSchemaFields =
  {
    requestId: authenticatorPickerNonEmptyStringSchema,
    vaultStoreId: authenticatorPickerNonEmptyStringSchema,
    secretId: authenticatorPickerNonEmptyStringSchema,
  }

type AuthenticatorPickerSelectMessageSchemaFields = {
  type: Schema.Literal<[AuthenticatorPickerSelectMessageType]>
  payload: Schema.Struct<{
    requestId: Schema.filter<typeof Schema.String>
    vaultStoreId: Schema.filter<typeof Schema.String>
    secretId: Schema.filter<typeof Schema.String>
  }>
}
const authenticatorPickerSelectMessageSchemaFields: AuthenticatorPickerSelectMessageSchemaFields =
  {
    type: Schema.Literal(
      AuthenticatorPickerSelectMessageType.NookAuthenticatorPickerSelect,
    ),
    payload: Schema.Struct(authenticatorPickerSelectMessagePayloadSchemaFields),
  }

const authenticatorPickerSelectMessageSchema = Schema.Struct(
  authenticatorPickerSelectMessageSchemaFields,
) satisfies Schema.Schema<AuthenticatorPickerSelectMessage>

type AuthenticatorPickerCancelMessagePayloadSchemaFields = {
  requestId: Schema.filter<typeof Schema.String>
}
const authenticatorPickerCancelMessagePayloadSchemaFields: AuthenticatorPickerCancelMessagePayloadSchemaFields =
  {
    requestId: authenticatorPickerNonEmptyStringSchema,
  }

type AuthenticatorPickerCancelMessageSchemaFields = {
  type: Schema.Literal<[AuthenticatorPickerCancelMessageType]>
  payload: Schema.Struct<{ requestId: Schema.filter<typeof Schema.String> }>
}
const authenticatorPickerCancelMessageSchemaFields: AuthenticatorPickerCancelMessageSchemaFields =
  {
    type: Schema.Literal(
      AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel,
    ),
    payload: Schema.Struct(authenticatorPickerCancelMessagePayloadSchemaFields),
  }

const authenticatorPickerCancelMessageSchema = Schema.Struct(
  authenticatorPickerCancelMessageSchemaFields,
) satisfies Schema.Schema<AuthenticatorPickerCancelMessage>

type WebsiteAuthenticatorSelectedMessagePayloadAccountSchemaFields = {
  vaultStoreId: Schema.filter<typeof Schema.String>
  secretId: Schema.filter<typeof Schema.String>
  authorizationGeneration: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorSelectedMessagePayloadAccountSchemaFields: WebsiteAuthenticatorSelectedMessagePayloadAccountSchemaFields =
  {
    vaultStoreId: authenticatorPickerNonEmptyStringSchema,
    secretId: authenticatorPickerNonEmptyStringSchema,
    authorizationGeneration: authenticatorPickerNonEmptyStringSchema,
  }

type WebsiteAuthenticatorSelectedMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
  requestId: Schema.filter<typeof Schema.String>
  account: Schema.Struct<{
    vaultStoreId: Schema.filter<typeof Schema.String>
    secretId: Schema.filter<typeof Schema.String>
    authorizationGeneration: Schema.filter<typeof Schema.String>
  }>
}
const websiteAuthenticatorSelectedMessagePayloadSchemaFields: WebsiteAuthenticatorSelectedMessagePayloadSchemaFields =
  {
    origin: authenticatorPickerNonEmptyStringSchema,
    requestId: authenticatorPickerNonEmptyStringSchema,
    account: Schema.Struct(
      websiteAuthenticatorSelectedMessagePayloadAccountSchemaFields,
    ),
  }

type WebsiteAuthenticatorSelectedMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorSelectedMessageType]>
  payload: Schema.Struct<{
    origin: Schema.filter<typeof Schema.String>
    requestId: Schema.filter<typeof Schema.String>
    account: Schema.Struct<{
      vaultStoreId: Schema.filter<typeof Schema.String>
      secretId: Schema.filter<typeof Schema.String>
      authorizationGeneration: Schema.filter<typeof Schema.String>
    }>
  }>
}
const websiteAuthenticatorSelectedMessageSchemaFields: WebsiteAuthenticatorSelectedMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorSelectedMessageType.NookWebsiteAuthenticatorSelected,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorSelectedMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorSelectedMessageSchema = Schema.Struct(
  websiteAuthenticatorSelectedMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorSelectedMessage>

type WebsiteAuthenticatorCanceledMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
  requestId: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorCanceledMessagePayloadSchemaFields: WebsiteAuthenticatorCanceledMessagePayloadSchemaFields =
  {
    origin: authenticatorPickerNonEmptyStringSchema,
    requestId: authenticatorPickerNonEmptyStringSchema,
  }

type WebsiteAuthenticatorCanceledMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorCanceledMessageType]>
  payload: Schema.Struct<{
    origin: Schema.filter<typeof Schema.String>
    requestId: Schema.filter<typeof Schema.String>
  }>
}
const websiteAuthenticatorCanceledMessageSchemaFields: WebsiteAuthenticatorCanceledMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorCanceledMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorCanceledMessageSchema = Schema.Struct(
  websiteAuthenticatorCanceledMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorCanceledMessage>
