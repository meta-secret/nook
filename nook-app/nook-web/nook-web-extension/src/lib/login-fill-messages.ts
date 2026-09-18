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
    authorizationGeneration: string
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

type WebsiteLoginFillFailureSchemaFields = {
  ok: Schema.Literal<[false]>
  reason: typeof Schema.String
}
const websiteLoginFillFailureSchemaFields: WebsiteLoginFillFailureSchemaFields =
  {
    ok: Schema.Literal(false),
    reason: Schema.String,
  }

type WebsiteLoginFillSuccessSchemaFields = {
  ok: Schema.Literal<[true]>
  username: typeof Schema.String
  password: typeof Schema.String
}
const websiteLoginFillSuccessSchemaFields: WebsiteLoginFillSuccessSchemaFields =
  {
    ok: Schema.Literal(true),
    username: Schema.String,
    password: Schema.String,
  }

const websiteLoginFillResponseSchema = Schema.Union(
  Schema.Struct(websiteLoginFillSuccessSchemaFields),
  Schema.Struct(websiteLoginFillFailureSchemaFields),
) satisfies Schema.Schema<WebsiteLoginFillResponse>

type WebsiteLoginOptionsMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
}
const websiteLoginOptionsMessagePayloadSchemaFields: WebsiteLoginOptionsMessagePayloadSchemaFields =
  { origin: nonEmptyStringSchema }

type WebsiteLoginOptionsMessageSchemaFields = {
  type: Schema.Literal<[WebsiteLoginOptionsMessageType]>
  payload: Schema.Struct<{ origin: Schema.filter<typeof Schema.String> }>
}
const websiteLoginOptionsMessageSchemaFields: WebsiteLoginOptionsMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions,
    ),
    payload: Schema.Struct(websiteLoginOptionsMessagePayloadSchemaFields),
  }

const websiteLoginOptionsMessageSchema = Schema.Struct(
  websiteLoginOptionsMessageSchemaFields,
) satisfies Schema.Schema<WebsiteLoginOptionsMessage>

type WebsiteLoginRevealMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
  vaultStoreId: Schema.filter<typeof Schema.String>
  secretId: Schema.filter<typeof Schema.String>
  authorizationGeneration: Schema.filter<typeof Schema.String>
}
const websiteLoginRevealMessagePayloadSchemaFields: WebsiteLoginRevealMessagePayloadSchemaFields =
  {
    origin: nonEmptyStringSchema,
    vaultStoreId: nonEmptyStringSchema,
    secretId: nonEmptyStringSchema,
    authorizationGeneration: nonEmptyStringSchema,
  }

type WebsiteLoginRevealMessageSchemaFields = {
  type: Schema.Literal<[WebsiteLoginRevealMessageType]>
  payload: Schema.Struct<{
    origin: Schema.filter<typeof Schema.String>
    vaultStoreId: Schema.filter<typeof Schema.String>
    secretId: Schema.filter<typeof Schema.String>
    authorizationGeneration: Schema.filter<typeof Schema.String>
  }>
}
const websiteLoginRevealMessageSchemaFields: WebsiteLoginRevealMessageSchemaFields =
  {
    type: Schema.Literal(WebsiteLoginRevealMessageType.NookWebsiteLoginFill),
    payload: Schema.Struct(websiteLoginRevealMessagePayloadSchemaFields),
  }

const websiteLoginRevealMessageSchema = Schema.Struct(
  websiteLoginRevealMessageSchemaFields,
) satisfies Schema.Schema<WebsiteLoginRevealMessage>

type WebsiteAuthenticatorOptionsMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
}
const websiteAuthenticatorOptionsMessagePayloadSchemaFields: WebsiteAuthenticatorOptionsMessagePayloadSchemaFields =
  { origin: nonEmptyStringSchema }

type WebsiteAuthenticatorOptionsMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorOptionsMessageType]>
  payload: Schema.Struct<{ origin: Schema.filter<typeof Schema.String> }>
}
const websiteAuthenticatorOptionsMessageSchemaFields: WebsiteAuthenticatorOptionsMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions,
    ),
    payload: Schema.Struct(
      websiteAuthenticatorOptionsMessagePayloadSchemaFields,
    ),
  }

const websiteAuthenticatorOptionsMessageSchema = Schema.Struct(
  websiteAuthenticatorOptionsMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorOptionsMessage>

type WebsiteAuthenticatorFillMessagePayloadSchemaFields = {
  origin: Schema.filter<typeof Schema.String>
  vaultStoreId: Schema.filter<typeof Schema.String>
  secretId: Schema.filter<typeof Schema.String>
  authorizationGeneration: Schema.optionalWith<
    Schema.filter<typeof Schema.String>,
    { exact: true }
  >
}
type ExactSchemaPropertyOptions = { readonly exact: true }
const exactSchemaPropertyOptions: ExactSchemaPropertyOptions = { exact: true }
const websiteAuthenticatorFillMessagePayloadSchemaFields: WebsiteAuthenticatorFillMessagePayloadSchemaFields =
  {
    origin: nonEmptyStringSchema,
    vaultStoreId: nonEmptyStringSchema,
    secretId: nonEmptyStringSchema,
    authorizationGeneration: Schema.optionalWith(
      nonEmptyStringSchema,
      exactSchemaPropertyOptions,
    ),
  }

type WebsiteAuthenticatorFillMessageSchemaFields = {
  type: Schema.Literal<[WebsiteAuthenticatorFillMessageType]>
  payload: Schema.Struct<{
    origin: Schema.filter<typeof Schema.String>
    vaultStoreId: Schema.filter<typeof Schema.String>
    secretId: Schema.filter<typeof Schema.String>
    authorizationGeneration: Schema.optionalWith<
      Schema.filter<typeof Schema.String>,
      { exact: true }
    >
  }>
}
const websiteAuthenticatorFillMessageSchemaFields: WebsiteAuthenticatorFillMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill,
    ),
    payload: Schema.Struct(websiteAuthenticatorFillMessagePayloadSchemaFields),
  }

const websiteAuthenticatorFillMessageSchema = Schema.Struct(
  websiteAuthenticatorFillMessageSchemaFields,
) satisfies Schema.Schema<WebsiteAuthenticatorFillMessage>
