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

const loginPickerQueryResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  origin: loginPickerNonEmptyStringSchema,
  accounts: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        vaultStoreId: loginPickerNonEmptyStringSchema,
        secretId: loginPickerNonEmptyStringSchema,
        username: Schema.String,
        websiteHost: Schema.String,
        websiteUrl: Schema.String,
        vaultName: Schema.String,
      }),
    ),
  ),
}) satisfies Schema.Schema<LoginPickerQueryResponse>

const loginPickerSelectResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
}) satisfies Schema.Schema<LoginPickerSelectResponse>

const websiteLoginPickerOpenMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen,
  ),
  payload: Schema.Struct({ origin: loginPickerNonEmptyStringSchema }),
}) satisfies Schema.Schema<WebsiteLoginPickerOpenMessage>

const loginPickerQueryMessageSchema = Schema.Struct({
  type: Schema.Literal(LoginPickerQueryMessageType.NookLoginPickerQuery),
  payload: Schema.Struct({
    requestId: loginPickerNonEmptyStringSchema,
    query: Schema.String.pipe(Schema.maxLength(MAX_LOGIN_SEARCH_LENGTH)),
  }),
}) satisfies Schema.Schema<LoginPickerQueryMessage>

const loginPickerSelectMessageSchema = Schema.Struct({
  type: Schema.Literal(LoginPickerSelectMessageType.NookLoginPickerSelect),
  payload: Schema.Struct({
    requestId: loginPickerNonEmptyStringSchema,
    vaultStoreId: loginPickerNonEmptyStringSchema,
    secretId: loginPickerNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<LoginPickerSelectMessage>

const loginPickerCancelMessageSchema = Schema.Struct({
  type: Schema.Literal(LoginPickerCancelMessageType.NookLoginPickerCancel),
  payload: Schema.Struct({ requestId: loginPickerNonEmptyStringSchema }),
}) satisfies Schema.Schema<LoginPickerCancelMessage>

const websiteLoginSelectedMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteLoginSelectedMessageType.NookWebsiteLoginSelected,
  ),
  payload: Schema.Struct({
    origin: loginPickerNonEmptyStringSchema,
    requestId: loginPickerNonEmptyStringSchema,
    account: Schema.Struct({
      vaultStoreId: loginPickerNonEmptyStringSchema,
      secretId: loginPickerNonEmptyStringSchema,
      authorizationGeneration: loginPickerNonEmptyStringSchema,
    }),
  }),
}) satisfies Schema.Schema<WebsiteLoginSelectedMessage>

const websiteLoginCanceledMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteLoginCanceledMessageType.NookWebsiteLoginCanceled,
  ),
  payload: Schema.Struct({
    origin: loginPickerNonEmptyStringSchema,
    requestId: loginPickerNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<WebsiteLoginCanceledMessage>
