import { Schema } from 'effect'

export type {
  WebsiteLoginAccountOption,
  WebsiteAuthenticatorOption,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type WebsiteLoginFillResponse =
  | { ok: true; username: string; password: string }
  | { ok: false; reason: string }

export enum WebsiteAuthenticatorResponseStatus {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

export enum WebsiteLoginOptionsMessageType {
  NookWebsiteLoginOptions = 'nook:website-login-options',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginOptionsMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions
  declare readonly payload: {
    origin: string
  }
  static decodeWebsiteLoginFillResponse(response: unknown) {
    return Schema.decodeUnknown(websiteLoginFillResponseSchema)(response)
  }

  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteLoginOptionsMessageSchema)(message)
  }
}

export enum WebsiteLoginRevealMessageType {
  NookWebsiteLoginFill = 'nook:website-login-fill',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteLoginRevealMessage {
  private constructor() {}
  declare readonly type: WebsiteLoginRevealMessageType.NookWebsiteLoginFill
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    secretId: string
    authorizationGeneration?: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteLoginRevealMessageSchema)(message)
  }
}

export enum WebsiteAuthenticatorOptionsMessageType {
  NookWebsiteAuthenticatorOptions = 'nook:website-authenticator-options',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorOptionsMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions
  declare readonly payload: {
    origin: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorOptionsMessageSchema)(
      message,
    )
  }
}

export enum WebsiteAuthenticatorFillMessageType {
  NookWebsiteAuthenticatorFill = 'nook:website-authenticator-fill',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorFillMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    secretId: string
    authorizationGeneration?: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websiteAuthenticatorFillMessageSchema)(message)
  }
}

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

const websiteLoginFillResponseSchema = Schema.Union(
  Schema.Struct({
    ok: Schema.Literal(true),
    username: Schema.String,
    password: Schema.String,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: Schema.String,
  }),
) satisfies Schema.Schema<WebsiteLoginFillResponse>

const websiteLoginOptionsMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions,
  ),
  payload: Schema.Struct({ origin: nonEmptyStringSchema }),
}) satisfies Schema.Schema<WebsiteLoginOptionsMessage>

const websiteLoginRevealMessageSchema = Schema.Struct({
  type: Schema.Literal(WebsiteLoginRevealMessageType.NookWebsiteLoginFill),
  payload: Schema.Struct({
    origin: nonEmptyStringSchema,
    vaultStoreId: nonEmptyStringSchema,
    secretId: nonEmptyStringSchema,
    authorizationGeneration: Schema.optionalWith(nonEmptyStringSchema, {
      exact: true,
    }),
  }),
}) satisfies Schema.Schema<WebsiteLoginRevealMessage>

const websiteAuthenticatorOptionsMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions,
  ),
  payload: Schema.Struct({ origin: nonEmptyStringSchema }),
}) satisfies Schema.Schema<WebsiteAuthenticatorOptionsMessage>

const websiteAuthenticatorFillMessageSchema = Schema.Struct({
  type: Schema.Literal(
    WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill,
  ),
  payload: Schema.Struct({
    origin: nonEmptyStringSchema,
    vaultStoreId: nonEmptyStringSchema,
    secretId: nonEmptyStringSchema,
    authorizationGeneration: nonEmptyStringSchema,
  }),
}) satisfies Schema.Schema<WebsiteAuthenticatorFillMessage>
