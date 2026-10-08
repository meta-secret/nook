import { Schema } from 'effect'

import type { WebsiteLoginAccountOption } from './login-fill-messages'

export const MAX_LOGIN_SEARCH_LENGTH = 200

export enum WebsiteLoginPickerOpenMessageType {
  NookWebsiteLoginPickerOpen = 'nook:website-login-picker-open',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginPickerOpenMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen
  declare readonly payload: {
    origin: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(websiteLoginPickerOpenMessageSchema)(
      message,
    )
  }
}

export enum LoginPickerQueryMessageType {
  NookLoginPickerQuery = 'nook:login-picker-query',
}

/** Owns admission of the concrete browser response returned for one query. */
export class LoginPickerQueryResponse {
  private constructor() {}
  declare readonly ok: true
  declare readonly origin: string
  declare readonly accounts: WebsiteLoginAccountOption[]

  static decode(response: unknown) {
    return Schema.decodeUnknownEffect(loginPickerQueryResponseSchema)(response)
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class LoginPickerQueryMessage {
  private constructor() {}
  declare readonly type: LoginPickerQueryMessageType.NookLoginPickerQuery
  declare readonly payload: {
    requestId: string
    query: string
    parentOrigin: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(loginPickerQueryMessageSchema)(message)
  }
}

export enum LoginPickerSelectMessageType {
  NookLoginPickerSelect = 'nook:login-picker-select',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class LoginPickerSelectMessage {
  private constructor() {}
  declare readonly type: LoginPickerSelectMessageType.NookLoginPickerSelect
  declare readonly payload: {
    requestId: string
    vaultStoreId: string
    secretId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(loginPickerSelectMessageSchema)(message)
  }
}

/** Structural browser acknowledgement returned after a selected account is delivered. */
export class LoginPickerSelectResponse {
  private constructor() {}
  declare readonly ok: true

  static decode(response: unknown) {
    return Schema.decodeUnknownEffect(loginPickerSelectResponseSchema)(response)
  }
}

export type LoginPickerRequestMessage =
  LoginPickerQueryMessage | LoginPickerSelectMessage

export enum LoginPickerRuntimeResponseKind {
  Query = 'query',
  Selected = 'selected',
  Rejected = 'rejected',
}

export type LoginPickerRuntimeResponse =
  | {
      readonly kind: LoginPickerRuntimeResponseKind.Query
      readonly response: LoginPickerQueryResponse
    }
  | { readonly kind: LoginPickerRuntimeResponseKind.Selected }
  | { readonly kind: LoginPickerRuntimeResponseKind.Rejected }

export enum LoginPickerCancelMessageType {
  NookLoginPickerCancel = 'nook:login-picker-cancel',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class LoginPickerCancelMessage {
  private constructor() {}
  declare readonly type: LoginPickerCancelMessageType.NookLoginPickerCancel
  declare readonly payload: {
    requestId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(loginPickerCancelMessageSchema)(message)
  }
}

export enum WebsiteLoginSelectedMessageType {
  NookWebsiteLoginSelected = 'nook:website-login-selected',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginSelectedMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected
  declare readonly payload: {
    origin: string
    requestId: string
    account: Pick<WebsiteLoginAccountOption, 'vaultStoreId' | 'secretId'> & {
      authorizationGeneration: string
    }
  }
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(websiteLoginSelectedMessageSchema)(
      message,
    )
  }
}

export enum WebsiteLoginCanceledMessageType {
  NookWebsiteLoginCanceled = 'nook:website-login-canceled',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginCanceledMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled
  declare readonly payload: {
    origin: string
    requestId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknownEffect(websiteLoginCanceledMessageSchema)(
      message,
    )
  }
}

const loginPickerNonEmptyStringSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
)

type LoginPickerQueryResponseAccountsSchemaFields = {
  vaultStoreId: typeof Schema.String
  secretId: typeof Schema.String
  username: typeof Schema.String
  websiteHost: typeof Schema.String
  websiteUrl: typeof Schema.String
  vaultName: typeof Schema.String
}
const loginPickerQueryResponseAccountsSchemaFields: LoginPickerQueryResponseAccountsSchemaFields =
  {
    vaultStoreId: loginPickerNonEmptyStringSchema,
    secretId: loginPickerNonEmptyStringSchema,
    username: Schema.String,
    websiteHost: Schema.String,
    websiteUrl: Schema.String,
    vaultName: Schema.String,
  }

type LoginPickerQueryResponseSchemaFields = {
  ok: Schema.Literal<true>
  origin: typeof Schema.String
  accounts: Schema.mutable<
    Schema.$Array<
      Schema.Struct<{
        vaultStoreId: typeof Schema.String
        secretId: typeof Schema.String
        username: typeof Schema.String
        websiteHost: typeof Schema.String
        websiteUrl: typeof Schema.String
        vaultName: typeof Schema.String
      }>
    >
  >
}
const loginPickerQueryResponseSchemaFields: LoginPickerQueryResponseSchemaFields =
  {
    ok: Schema.Literal(true),
    origin: loginPickerNonEmptyStringSchema,
    accounts: Schema.mutable(
      Schema.Array(Schema.Struct(loginPickerQueryResponseAccountsSchemaFields)),
    ),
  }

const loginPickerQueryResponseSchema = Schema.Struct(
  loginPickerQueryResponseSchemaFields,
) satisfies Schema.Codec<LoginPickerQueryResponse>

type LoginPickerSelectResponseSchemaFields = { ok: Schema.Literal<true> }
const loginPickerSelectResponseSchemaFields: LoginPickerSelectResponseSchemaFields =
  {
    ok: Schema.Literal(true),
  }

const loginPickerSelectResponseSchema = Schema.Struct(
  loginPickerSelectResponseSchemaFields,
) satisfies Schema.Codec<LoginPickerSelectResponse>

type WebsiteLoginPickerOpenMessagePayloadSchemaFields = {
  origin: typeof Schema.String
}
const websiteLoginPickerOpenMessagePayloadSchemaFields: WebsiteLoginPickerOpenMessagePayloadSchemaFields =
  { origin: loginPickerNonEmptyStringSchema }

type WebsiteLoginPickerOpenMessageSchemaFields = {
  type: Schema.Literal<WebsiteLoginPickerOpenMessageType>
  payload: Schema.Struct<{ origin: typeof Schema.String }>
}
const websiteLoginPickerOpenMessageSchemaFields: WebsiteLoginPickerOpenMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen,
    ),
    payload: Schema.Struct(websiteLoginPickerOpenMessagePayloadSchemaFields),
  }

const websiteLoginPickerOpenMessageSchema = Schema.Struct(
  websiteLoginPickerOpenMessageSchemaFields,
) satisfies Schema.Codec<WebsiteLoginPickerOpenMessage>

type LoginPickerQueryMessagePayloadSchemaFields = {
  requestId: typeof Schema.String
  query: typeof Schema.String
  parentOrigin: typeof Schema.String
}
const loginPickerQueryMessagePayloadSchemaFields: LoginPickerQueryMessagePayloadSchemaFields =
  {
    requestId: loginPickerNonEmptyStringSchema,
    query: Schema.String.pipe(
      Schema.check(Schema.isMaxLength(MAX_LOGIN_SEARCH_LENGTH)),
    ),
    parentOrigin: loginPickerNonEmptyStringSchema,
  }

type LoginPickerQueryMessageSchemaFields = {
  type: Schema.Literal<LoginPickerQueryMessageType>
  payload: Schema.Struct<{
    requestId: typeof Schema.String
    query: typeof Schema.String
    parentOrigin: typeof Schema.String
  }>
}
const loginPickerQueryMessageSchemaFields: LoginPickerQueryMessageSchemaFields =
  {
    type: Schema.Literal(LoginPickerQueryMessageType.NookLoginPickerQuery),
    payload: Schema.Struct(loginPickerQueryMessagePayloadSchemaFields),
  }

const loginPickerQueryMessageSchema = Schema.Struct(
  loginPickerQueryMessageSchemaFields,
) satisfies Schema.Codec<LoginPickerQueryMessage>

type LoginPickerSelectMessagePayloadSchemaFields = {
  requestId: typeof Schema.String
  vaultStoreId: typeof Schema.String
  secretId: typeof Schema.String
}
const loginPickerSelectMessagePayloadSchemaFields: LoginPickerSelectMessagePayloadSchemaFields =
  {
    requestId: loginPickerNonEmptyStringSchema,
    vaultStoreId: loginPickerNonEmptyStringSchema,
    secretId: loginPickerNonEmptyStringSchema,
  }

type LoginPickerSelectMessageSchemaFields = {
  type: Schema.Literal<LoginPickerSelectMessageType>
  payload: Schema.Struct<{
    requestId: typeof Schema.String
    vaultStoreId: typeof Schema.String
    secretId: typeof Schema.String
  }>
}
const loginPickerSelectMessageSchemaFields: LoginPickerSelectMessageSchemaFields =
  {
    type: Schema.Literal(LoginPickerSelectMessageType.NookLoginPickerSelect),
    payload: Schema.Struct(loginPickerSelectMessagePayloadSchemaFields),
  }

const loginPickerSelectMessageSchema = Schema.Struct(
  loginPickerSelectMessageSchemaFields,
) satisfies Schema.Codec<LoginPickerSelectMessage>

type LoginPickerCancelMessagePayloadSchemaFields = {
  requestId: typeof Schema.String
}
const loginPickerCancelMessagePayloadSchemaFields: LoginPickerCancelMessagePayloadSchemaFields =
  { requestId: loginPickerNonEmptyStringSchema }

type LoginPickerCancelMessageSchemaFields = {
  type: Schema.Literal<LoginPickerCancelMessageType>
  payload: Schema.Struct<{ requestId: typeof Schema.String }>
}
const loginPickerCancelMessageSchemaFields: LoginPickerCancelMessageSchemaFields =
  {
    type: Schema.Literal(LoginPickerCancelMessageType.NookLoginPickerCancel),
    payload: Schema.Struct(loginPickerCancelMessagePayloadSchemaFields),
  }

const loginPickerCancelMessageSchema = Schema.Struct(
  loginPickerCancelMessageSchemaFields,
) satisfies Schema.Codec<LoginPickerCancelMessage>

type WebsiteLoginSelectedMessagePayloadAccountSchemaFields = {
  vaultStoreId: typeof Schema.String
  secretId: typeof Schema.String
  authorizationGeneration: typeof Schema.String
}
const websiteLoginSelectedMessagePayloadAccountSchemaFields: WebsiteLoginSelectedMessagePayloadAccountSchemaFields =
  {
    vaultStoreId: loginPickerNonEmptyStringSchema,
    secretId: loginPickerNonEmptyStringSchema,
    authorizationGeneration: loginPickerNonEmptyStringSchema,
  }

type WebsiteLoginSelectedMessagePayloadSchemaFields = {
  origin: typeof Schema.String
  requestId: typeof Schema.String
  account: Schema.Struct<{
    vaultStoreId: typeof Schema.String
    secretId: typeof Schema.String
    authorizationGeneration: typeof Schema.String
  }>
}
const websiteLoginSelectedMessagePayloadSchemaFields: WebsiteLoginSelectedMessagePayloadSchemaFields =
  {
    origin: loginPickerNonEmptyStringSchema,
    requestId: loginPickerNonEmptyStringSchema,
    account: Schema.Struct(
      websiteLoginSelectedMessagePayloadAccountSchemaFields,
    ),
  }

type WebsiteLoginSelectedMessageSchemaFields = {
  type: Schema.Literal<WebsiteLoginSelectedMessageType>
  payload: Schema.Struct<{
    origin: typeof Schema.String
    requestId: typeof Schema.String
    account: Schema.Struct<{
      vaultStoreId: typeof Schema.String
      secretId: typeof Schema.String
      authorizationGeneration: typeof Schema.String
    }>
  }>
}
const websiteLoginSelectedMessageSchemaFields: WebsiteLoginSelectedMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected,
    ),
    payload: Schema.Struct(websiteLoginSelectedMessagePayloadSchemaFields),
  }

const websiteLoginSelectedMessageSchema = Schema.Struct(
  websiteLoginSelectedMessageSchemaFields,
) satisfies Schema.Codec<WebsiteLoginSelectedMessage>

type WebsiteLoginCanceledMessagePayloadSchemaFields = {
  origin: typeof Schema.String
  requestId: typeof Schema.String
}
const websiteLoginCanceledMessagePayloadSchemaFields: WebsiteLoginCanceledMessagePayloadSchemaFields =
  {
    origin: loginPickerNonEmptyStringSchema,
    requestId: loginPickerNonEmptyStringSchema,
  }

type WebsiteLoginCanceledMessageSchemaFields = {
  type: Schema.Literal<WebsiteLoginCanceledMessageType>
  payload: Schema.Struct<{
    origin: typeof Schema.String
    requestId: typeof Schema.String
  }>
}
const websiteLoginCanceledMessageSchemaFields: WebsiteLoginCanceledMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled,
    ),
    payload: Schema.Struct(websiteLoginCanceledMessagePayloadSchemaFields),
  }

const websiteLoginCanceledMessageSchema = Schema.Struct(
  websiteLoginCanceledMessageSchemaFields,
) satisfies Schema.Codec<WebsiteLoginCanceledMessage>
