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
    return Schema.decodeUnknown(websiteLoginPickerOpenMessageSchema)(message)
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
    return Schema.decodeUnknown(loginPickerQueryResponseSchema)(response)
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class LoginPickerQueryMessage {
  private constructor() {}
  declare readonly type: LoginPickerQueryMessageType.NookLoginPickerQuery
  declare readonly payload: {
    requestId: string
    query: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(loginPickerQueryMessageSchema)(message)
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
    return Schema.decodeUnknown(loginPickerSelectMessageSchema)(message)
  }
}

/** Structural browser acknowledgement returned after a selected account is delivered. */
export class LoginPickerSelectResponse {
  private constructor() {}
  declare readonly ok: true

  static decode(response: unknown) {
    return Schema.decodeUnknown(loginPickerSelectResponseSchema)(response)
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
    return Schema.decodeUnknown(loginPickerCancelMessageSchema)(message)
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
    return Schema.decodeUnknown(websiteLoginSelectedMessageSchema)(message)
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
    return Schema.decodeUnknown(websiteLoginCanceledMessageSchema)(message)
  }
}

const loginPickerNonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

type LoginPickerQueryResponseAccountsSchemaFields = {
  vaultStoreId: Schema.filter<typeof Schema.String>
  secretId: Schema.filter<typeof Schema.String>
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
  ok: Schema.Literal<[true]>
  origin: Schema.filter<typeof Schema.String>
  accounts: Schema.mutable<
    Schema.Array$<
      Schema.Struct<{
        vaultStoreId: Schema.filter<typeof Schema.String>
        secretId: Schema.filter<typeof Schema.String>
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
) satisfies Schema.Schema<LoginPickerQueryResponse>

type LoginPickerSelectResponseSchemaFields = { ok: Schema.Literal<[true]> }
const loginPickerSelectResponseSchemaFields: LoginPickerSelectResponseSchemaFields =
  {
    ok: Schema.Literal(true),
  }

const loginPickerSelectResponseSchema = Schema.Struct(
  loginPickerSelectResponseSchemaFields,
) satisfies Schema.Schema<LoginPickerSelectResponse>

type WebsiteLoginPickerOpenMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
}
const websiteLoginPickerOpenMessagePayloadSchemaFields: WebsiteLoginPickerOpenMessagePayloadSchemaFields =
  { origin: loginPickerNonEmptyStringSchema }

type WebsiteLoginPickerOpenMessageSchemaFields = {
  type: Schema.Literal<[WebsiteLoginPickerOpenMessageType]>
  payload: Schema.Struct<{ origin: Schema.filter<typeof Schema.String> }>
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
) satisfies Schema.Schema<WebsiteLoginPickerOpenMessage>

type LoginPickerQueryMessagePayloadSchemaFields = {
  requestId: Schema.filter<typeof Schema.String>
  query: Schema.filter<typeof Schema.String>
}
const loginPickerQueryMessagePayloadSchemaFields: LoginPickerQueryMessagePayloadSchemaFields =
  {
    requestId: loginPickerNonEmptyStringSchema,
    query: Schema.String.pipe(Schema.maxLength(MAX_LOGIN_SEARCH_LENGTH)),
  }

type LoginPickerQueryMessageSchemaFields = {
  type: Schema.Literal<[LoginPickerQueryMessageType]>
  payload: Schema.Struct<{
    requestId: Schema.filter<typeof Schema.String>
    query: Schema.filter<typeof Schema.String>
  }>
}
const loginPickerQueryMessageSchemaFields: LoginPickerQueryMessageSchemaFields =
  {
    type: Schema.Literal(LoginPickerQueryMessageType.NookLoginPickerQuery),
    payload: Schema.Struct(loginPickerQueryMessagePayloadSchemaFields),
  }

const loginPickerQueryMessageSchema = Schema.Struct(
  loginPickerQueryMessageSchemaFields,
) satisfies Schema.Schema<LoginPickerQueryMessage>

type LoginPickerSelectMessagePayloadSchemaFields = {
  requestId: Schema.filter<typeof Schema.String>
  vaultStoreId: Schema.filter<typeof Schema.String>
  secretId: Schema.filter<typeof Schema.String>
}
const loginPickerSelectMessagePayloadSchemaFields: LoginPickerSelectMessagePayloadSchemaFields =
  {
    requestId: loginPickerNonEmptyStringSchema,
    vaultStoreId: loginPickerNonEmptyStringSchema,
    secretId: loginPickerNonEmptyStringSchema,
  }

type LoginPickerSelectMessageSchemaFields = {
  type: Schema.Literal<[LoginPickerSelectMessageType]>
  payload: Schema.Struct<{
    requestId: Schema.filter<typeof Schema.String>
    vaultStoreId: Schema.filter<typeof Schema.String>
    secretId: Schema.filter<typeof Schema.String>
  }>
}
const loginPickerSelectMessageSchemaFields: LoginPickerSelectMessageSchemaFields =
  {
    type: Schema.Literal(LoginPickerSelectMessageType.NookLoginPickerSelect),
    payload: Schema.Struct(loginPickerSelectMessagePayloadSchemaFields),
  }

const loginPickerSelectMessageSchema = Schema.Struct(
  loginPickerSelectMessageSchemaFields,
) satisfies Schema.Schema<LoginPickerSelectMessage>

type LoginPickerCancelMessagePayloadSchemaFields = {
  requestId: Schema.filter<typeof Schema.String>
}
const loginPickerCancelMessagePayloadSchemaFields: LoginPickerCancelMessagePayloadSchemaFields =
  { requestId: loginPickerNonEmptyStringSchema }

type LoginPickerCancelMessageSchemaFields = {
  type: Schema.Literal<[LoginPickerCancelMessageType]>
  payload: Schema.Struct<{ requestId: Schema.filter<typeof Schema.String> }>
}
const loginPickerCancelMessageSchemaFields: LoginPickerCancelMessageSchemaFields =
  {
    type: Schema.Literal(LoginPickerCancelMessageType.NookLoginPickerCancel),
    payload: Schema.Struct(loginPickerCancelMessagePayloadSchemaFields),
  }

const loginPickerCancelMessageSchema = Schema.Struct(
  loginPickerCancelMessageSchemaFields,
) satisfies Schema.Schema<LoginPickerCancelMessage>

type WebsiteLoginSelectedMessagePayloadAccountSchemaFields = {
  vaultStoreId: Schema.filter<typeof Schema.String>
  secretId: Schema.filter<typeof Schema.String>
  authorizationGeneration: Schema.filter<typeof Schema.String>
}
const websiteLoginSelectedMessagePayloadAccountSchemaFields: WebsiteLoginSelectedMessagePayloadAccountSchemaFields =
  {
    vaultStoreId: loginPickerNonEmptyStringSchema,
    secretId: loginPickerNonEmptyStringSchema,
    authorizationGeneration: loginPickerNonEmptyStringSchema,
  }

type WebsiteLoginSelectedMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
  requestId: Schema.filter<typeof Schema.String>
  account: Schema.Struct<{
    vaultStoreId: Schema.filter<typeof Schema.String>
    secretId: Schema.filter<typeof Schema.String>
    authorizationGeneration: Schema.filter<typeof Schema.String>
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
  type: Schema.Literal<[WebsiteLoginSelectedMessageType]>
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
const websiteLoginSelectedMessageSchemaFields: WebsiteLoginSelectedMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected,
    ),
    payload: Schema.Struct(websiteLoginSelectedMessagePayloadSchemaFields),
  }

const websiteLoginSelectedMessageSchema = Schema.Struct(
  websiteLoginSelectedMessageSchemaFields,
) satisfies Schema.Schema<WebsiteLoginSelectedMessage>

type WebsiteLoginCanceledMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
  requestId: Schema.filter<typeof Schema.String>
}
const websiteLoginCanceledMessagePayloadSchemaFields: WebsiteLoginCanceledMessagePayloadSchemaFields =
  {
    origin: loginPickerNonEmptyStringSchema,
    requestId: loginPickerNonEmptyStringSchema,
  }

type WebsiteLoginCanceledMessageSchemaFields = {
  type: Schema.Literal<[WebsiteLoginCanceledMessageType]>
  payload: Schema.Struct<{
    origin: Schema.filter<typeof Schema.String>
    requestId: Schema.filter<typeof Schema.String>
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
) satisfies Schema.Schema<WebsiteLoginCanceledMessage>
