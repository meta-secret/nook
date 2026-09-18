import { Schema } from 'effect'

import {
  decode_website_passkey_registration_request,
  decode_website_passkey_assertion_request,
  type PasskeyRegistrationRequest,
  type PasskeyAssertionRequest,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { extensionWasmRuntime } from './nook-wasm'
import {
  WebsitePasskeyCancelMessageType,
  WebsitePasskeyCeremony,
  WebsitePasskeyOptionsMessageType,
  WebsitePasskeyOptionsStatus,
  WebsitePasskeyPerformMessageType,
} from './webauthn-message-types'

export {
  WebsitePasskeyCancelMessageType,
  WebsitePasskeyCeremony,
  WebsitePasskeyOptionsMessageType,
  WebsitePasskeyOptionsStatus,
  WebsitePasskeyPerformMessageType,
} from './webauthn-message-types'

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsitePasskeyOptionsMessage {
  private constructor() {}
  declare readonly type: WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions
  declare readonly payload: {
    requestId: string
    ceremony: WebsitePasskeyCeremony
    requestJson: string
    expiresAt: number
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websitePasskeyOptionsMessageSchema)(message)
  }

  static async parsedWebsitePasskeyRequest(
    args: ParseWebsitePasskeyRequestArgs,
  ): Promise<WebsitePasskeyRequestParse> {
    await extensionWasmRuntime.ensureNookWasm()
    try {
      if (args.ceremony === WebsitePasskeyCeremony.Get) {
        const value = decode_website_passkey_assertion_request(args.requestJson)
        return {
          kind: WebsitePasskeyRequestParseKind.Parsed,
          request: {
            ceremony: WebsitePasskeyCeremony.Get,
            value,
          },
        }
      }
      const value = decode_website_passkey_registration_request(
        args.requestJson,
      )
      return {
        kind: WebsitePasskeyRequestParseKind.Parsed,
        request: {
          ceremony: WebsitePasskeyCeremony.Create,
          value,
        },
      }
    } catch {
      return { kind: WebsitePasskeyRequestParseKind.Rejected }
    }
  }

  static websitePasskeyRequestJson(
    args: WebsitePasskeyRequestJsonArgs,
  ): string {
    if (
      args.request.ceremony !== WebsitePasskeyCeremony.Get ||
      args.credentialSelection.kind ===
        WebsitePasskeyCredentialSelectionKind.RequestDefaults
    ) {
      return JSON.stringify(args.request.value)
    }
    if (args.credentialSelection.credentialId.length === 0) {
      throw new Error('Selected passkey credential ID must not be empty.')
    }
    const request: PasskeyAssertionRequest = {
      ...args.request.value,
      allowCredentials: [{ id: args.credentialSelection.credentialId }],
    }
    return JSON.stringify(request)
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsitePasskeyPerformMessage {
  private constructor() {}
  declare readonly type: WebsitePasskeyPerformMessageType.NookWebsitePasskeyPerform
  declare readonly payload: WebsitePasskeyOptionsMessage['payload'] & {
    vaultStoreId: string
    credentialId?: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websitePasskeyPerformMessageSchema)(message)
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsitePasskeyCancelMessage {
  private constructor() {}
  declare readonly type: WebsitePasskeyCancelMessageType.NookWebsitePasskeyCancel
  declare readonly payload: {
    requestId: string
  }
  static decode(message: unknown) {
    return Schema.decodeUnknown(websitePasskeyCancelMessageSchema)(message)
  }
}

const websitePasskeyRequestIdSchema = Schema.String.pipe(
  Schema.minLength(16),
  Schema.maxLength(128),
)

type WebsitePasskeyOptionsPayloadSchemaFields = {
  requestId: Schema.filter<Schema.filter<typeof Schema.String>>
  ceremony: Schema.Literal<
    [WebsitePasskeyCeremony.Create, WebsitePasskeyCeremony.Get]
  >
  requestJson: Schema.filter<Schema.filter<typeof Schema.String>>
  expiresAt: Schema.filter<Schema.filter<typeof Schema.Number>>
}
const websitePasskeyOptionsPayloadSchemaFields: WebsitePasskeyOptionsPayloadSchemaFields =
  {
    requestId: websitePasskeyRequestIdSchema,
    ceremony: Schema.Literal(
      WebsitePasskeyCeremony.Create,
      WebsitePasskeyCeremony.Get,
    ),
    requestJson: Schema.String.pipe(
      Schema.minLength(1),
      Schema.maxLength(65_536),
    ),
    expiresAt: Schema.Number.pipe(
      Schema.filter((expiresAt) => Number.isFinite(expiresAt)),
      Schema.filter((expiresAt) => expiresAt > Date.now()),
    ),
  }

const websitePasskeyOptionsPayloadSchema = Schema.Struct(
  websitePasskeyOptionsPayloadSchemaFields,
) satisfies Schema.Schema<WebsitePasskeyOptionsMessage['payload']>

type WebsitePasskeyOptionsMessageSchemaFields = {
  type: Schema.Literal<[WebsitePasskeyOptionsMessageType]>
  payload: Schema.Struct<{
    requestId: Schema.filter<Schema.filter<typeof Schema.String>>
    ceremony: Schema.Literal<
      [WebsitePasskeyCeremony.Create, WebsitePasskeyCeremony.Get]
    >
    requestJson: Schema.filter<Schema.filter<typeof Schema.String>>
    expiresAt: Schema.filter<Schema.filter<typeof Schema.Number>>
  }>
}
const websitePasskeyOptionsMessageSchemaFields: WebsitePasskeyOptionsMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions,
    ),
    payload: websitePasskeyOptionsPayloadSchema,
  }

const websitePasskeyOptionsMessageSchema = Schema.Struct(
  websitePasskeyOptionsMessageSchemaFields,
) satisfies Schema.Schema<WebsitePasskeyOptionsMessage>

type WebsitePasskeyPerformMessagePayloadSchemaFields = {
  vaultStoreId: Schema.filter<typeof Schema.String>
  credentialId: Schema.optionalWith<
    Schema.filter<typeof Schema.String>,
    { exact: true }
  >
  requestId: Schema.filter<Schema.filter<typeof Schema.String>>
  ceremony: Schema.Literal<
    [WebsitePasskeyCeremony.Create, WebsitePasskeyCeremony.Get]
  >
  requestJson: Schema.filter<Schema.filter<typeof Schema.String>>
  expiresAt: Schema.filter<Schema.filter<typeof Schema.Number>>
}
type ExactSchemaPropertyOptions = { readonly exact: true }
const exactSchemaPropertyOptions: ExactSchemaPropertyOptions = { exact: true }
const websitePasskeyPerformMessagePayloadSchemaFields: WebsitePasskeyPerformMessagePayloadSchemaFields =
  {
    ...websitePasskeyOptionsPayloadSchema.fields,
    vaultStoreId: Schema.String.pipe(Schema.minLength(1)),
    credentialId: Schema.optionalWith(
      Schema.String.pipe(Schema.minLength(1)),
      exactSchemaPropertyOptions,
    ),
  }

type WebsitePasskeyPerformMessageSchemaFields = {
  type: Schema.Literal<[WebsitePasskeyPerformMessageType]>
  payload: Schema.Struct<{
    vaultStoreId: Schema.filter<typeof Schema.String>
    credentialId: Schema.optionalWith<
      Schema.filter<typeof Schema.String>,
      { exact: true }
    >
    requestId: Schema.filter<Schema.filter<typeof Schema.String>>
    ceremony: Schema.Literal<
      [WebsitePasskeyCeremony.Create, WebsitePasskeyCeremony.Get]
    >
    requestJson: Schema.filter<Schema.filter<typeof Schema.String>>
    expiresAt: Schema.filter<Schema.filter<typeof Schema.Number>>
  }>
}
const websitePasskeyPerformMessageSchemaFields: WebsitePasskeyPerformMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsitePasskeyPerformMessageType.NookWebsitePasskeyPerform,
    ),
    payload: Schema.Struct(websitePasskeyPerformMessagePayloadSchemaFields),
  }

const websitePasskeyPerformMessageSchema = Schema.Struct(
  websitePasskeyPerformMessageSchemaFields,
) satisfies Schema.Schema<WebsitePasskeyPerformMessage>

type WebsitePasskeyCancelMessagePayloadSchemaFields = {
  requestId: Schema.filter<Schema.filter<typeof Schema.String>>
}
const websitePasskeyCancelMessagePayloadSchemaFields: WebsitePasskeyCancelMessagePayloadSchemaFields =
  { requestId: websitePasskeyRequestIdSchema }

type WebsitePasskeyCancelMessageSchemaFields = {
  type: Schema.Literal<[WebsitePasskeyCancelMessageType]>
  payload: Schema.Struct<{
    requestId: Schema.filter<Schema.filter<typeof Schema.String>>
  }>
}
const websitePasskeyCancelMessageSchemaFields: WebsitePasskeyCancelMessageSchemaFields =
  {
    type: Schema.Literal(
      WebsitePasskeyCancelMessageType.NookWebsitePasskeyCancel,
    ),
    payload: Schema.Struct(websitePasskeyCancelMessagePayloadSchemaFields),
  }

const websitePasskeyCancelMessageSchema = Schema.Struct(
  websitePasskeyCancelMessageSchemaFields,
) satisfies Schema.Schema<WebsitePasskeyCancelMessage>

export type WebsitePasskeyAccount = {
  credentialId: string
  userName: string
  userDisplayName: string
}

export type WebsitePasskeyVaultOption = {
  vaultStoreId: string
  vaultName: string
  account?: WebsitePasskeyAccount
}

export type WebsitePasskeyOptionsResponse =
  | { ok: false; reason: string }
  | {
      ok: true
      status: WebsitePasskeyOptionsStatus
      options: WebsitePasskeyVaultOption[]
    }

export type WebsitePasskeyRegistrationResponse = {
  ok: true
  credentialId: string
  clientDataJSON: string
  attestationObject: string
  transports: string[]
}

export type WebsitePasskeyAssertionResponse = {
  ok: true
  credentialId: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  userHandle: string
}

export type WebsitePasskeyPerformResponse =
  | { ok: false; reason: string }
  | WebsitePasskeyRegistrationResponse
  | WebsitePasskeyAssertionResponse

export enum WebsitePasskeyRequestParseKind {
  Parsed = 'parsed',
  Rejected = 'rejected',
}

export type WebsitePasskeyRequestParse =
  | {
      kind: WebsitePasskeyRequestParseKind.Parsed
      request: WebsitePasskeyRequest
    }
  | { kind: WebsitePasskeyRequestParseKind.Rejected }

export type WebsitePasskeyRequest =
  | {
      ceremony: WebsitePasskeyCeremony.Create
      value: PasskeyRegistrationRequest
    }
  | {
      ceremony: WebsitePasskeyCeremony.Get
      value: PasskeyAssertionRequest
    }

export type ParseWebsitePasskeyRequestArgs = {
  ceremony: WebsitePasskeyCeremony
  requestJson: string
}

export type WebsitePasskeyRequestJsonArgs = {
  request: WebsitePasskeyRequest
  credentialSelection: WebsitePasskeyCredentialSelection
}

export enum WebsitePasskeyCredentialSelectionKind {
  RequestDefaults = 'request-defaults',
  Selected = 'selected',
}

export type WebsitePasskeyCredentialSelection =
  | { kind: WebsitePasskeyCredentialSelectionKind.RequestDefaults }
  | {
      kind: WebsitePasskeyCredentialSelectionKind.Selected
      credentialId: string
    }
