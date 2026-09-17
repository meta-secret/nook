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
    return Schema.decodeUnknown(
      websiteAuthenticatorPickerOpenMessageSchema,
    )(message)
  }
}

export enum AuthenticatorPickerQueryMessageType {
  NookAuthenticatorPickerQuery = 'nook:authenticator-picker-query',
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
    return Schema.decodeUnknown(authenticatorPickerSelectMessageSchema)(
      message,
    )
  }
}

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
    return Schema.decodeUnknown(authenticatorPickerCancelMessageSchema)(
      message,
    )
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

const websiteAuthenticatorPickerOpenMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen,
  ),
  payload: Schema.Struct({ origin: authenticatorPickerNonEmptyStringSchema }),
}) satisfies Schema.Schema<WebsiteAuthenticatorPickerOpenMessage>

const authenticatorPickerQueryMessageSchema = Schema.Struct({
  type: Schema.Literal(
    AuthenticatorPickerQueryMessageType.NookAuthenticatorPickerQuery,
  ),
  payload: Schema.Struct({
    requestId: authenticatorPickerNonEmptyStringSchema,
    query: Schema.String.pipe(Schema.maxLength(MAX_AUTHENTICATOR_SEARCH_LENGTH)),
  }),
}) satisfies Schema.Schema<AuthenticatorPickerQueryMessage>

const authenticatorPickerSelectMessageSchema = Schema.Struct({
  type: Schema.Literal(
    AuthenticatorPickerSelectMessageType.NookAuthenticatorPickerSelect,
  ),
  payload: Schema.Struct({
    requestId: authenticatorPickerNonEmptyStringSchema,
    vaultStoreId: authenticatorPickerNonEmptyStringSchema,
    secretId: authenticatorPickerNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<AuthenticatorPickerSelectMessage>

const authenticatorPickerCancelMessageSchema = Schema.Struct({
  type: Schema.Literal(
    AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel,
  ),
  payload: Schema.Struct({
    requestId: authenticatorPickerNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<AuthenticatorPickerCancelMessage>

const websiteAuthenticatorSelectedMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorSelectedMessageType.NookWebsiteAuthenticatorSelected,
  ),
  payload: Schema.Struct({
    origin: authenticatorPickerNonEmptyStringSchema,
    requestId: authenticatorPickerNonEmptyStringSchema,
    account: Schema.Struct({
      vaultStoreId: authenticatorPickerNonEmptyStringSchema,
      secretId: authenticatorPickerNonEmptyStringSchema,
      authorizationGeneration: authenticatorPickerNonEmptyStringSchema,
    }),
  }),
}) satisfies Schema.Schema<WebsiteAuthenticatorSelectedMessage>

const websiteAuthenticatorCanceledMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorCanceledMessageType.NookWebsiteAuthenticatorCanceled,
  ),
  payload: Schema.Struct({
    origin: authenticatorPickerNonEmptyStringSchema,
    requestId: authenticatorPickerNonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<WebsiteAuthenticatorCanceledMessage>
