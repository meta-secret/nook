import { Schema } from 'effect'
import {
  LoginPickerFrameBindingKind,
  type LoginPickerFrameBinding,
} from '../../lib/inline-login-picker'
import type { ExtensionSessionStorageValue } from './pairing-identity-storage'

export type PendingAuthenticatorPicker = {
  requestId: string
  origin: string
  tabId: number
  frameId: number
  allowedVaultStoreIds: readonly string[]
  expiresAt: number
}

export type PendingLoginPicker = PendingAuthenticatorPicker & {
  readonly parentDocumentId: string
  pickerDocument: LoginPickerFrameBinding
}

type SessionAuthenticatorAccount = {
  readonly secretId: string
  readonly issuer: string
  readonly account: string
}

type SessionLoginAccount = {
  readonly secretId: string
  readonly username: string
  readonly websiteUrl: string
  readonly websiteHost: string
}

export type SessionAccount = SessionAuthenticatorAccount | SessionLoginAccount

type SessionPasskeyAccount = {
  readonly credentialId: string
  readonly userName: string
  readonly userDisplayName: string
}

type SessionAccountWireValue = readonly (
  SessionAuthenticatorAccount | SessionLoginAccount | SessionPasskeyAccount
)[]

type SessionAuthenticatorAccountSchemaFields = {
  readonly secretId: typeof Schema.String
  readonly issuer: typeof Schema.String
  readonly account: typeof Schema.String
}

const sessionAuthenticatorAccountSchemaFields: SessionAuthenticatorAccountSchemaFields =
  {
    secretId: Schema.String,
    issuer: Schema.String,
    account: Schema.String,
  }
const sessionAuthenticatorAccountSchema = Schema.Struct(
  sessionAuthenticatorAccountSchemaFields,
) satisfies Schema.Schema<SessionAuthenticatorAccount>

type SessionLoginAccountSchemaFields = {
  readonly secretId: typeof Schema.String
  readonly username: typeof Schema.String
  readonly websiteUrl: typeof Schema.String
  readonly websiteHost: typeof Schema.String
}

const sessionLoginAccountSchemaFields: SessionLoginAccountSchemaFields = {
  secretId: Schema.String,
  username: Schema.String,
  websiteUrl: Schema.String,
  websiteHost: Schema.String,
}
const sessionLoginAccountSchema = Schema.Struct(
  sessionLoginAccountSchemaFields,
) satisfies Schema.Schema<SessionLoginAccount>

const sessionAccountsSchema = Schema.Array(
  Schema.Union(sessionAuthenticatorAccountSchema, sessionLoginAccountSchema),
) satisfies Schema.Schema<readonly SessionAccount[]>

type PendingAuthenticatorPickerSchemaFields = {
  requestId: typeof Schema.String
  origin: typeof Schema.String
  tabId: Schema.filter<typeof Schema.Number>
  frameId: Schema.filter<typeof Schema.Number>
  allowedVaultStoreIds: Schema.Array$<Schema.filter<typeof Schema.String>>
  expiresAt: Schema.filter<typeof Schema.Number>
}

const pendingAuthenticatorPickerSchemaFields: PendingAuthenticatorPickerSchemaFields =
  {
    requestId: Schema.String,
    origin: Schema.String,
    tabId: Schema.Number.pipe(
      Schema.filter((value) => Number.isInteger(value) && value >= 0),
    ),
    frameId: Schema.Number.pipe(
      Schema.filter((value) => Number.isInteger(value) && value >= 0),
    ),
    allowedVaultStoreIds: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
    expiresAt: Schema.Number.pipe(Schema.filter(Number.isFinite)),
  }

const pendingAuthenticatorPickerSchema = Schema.Struct(
  pendingAuthenticatorPickerSchemaFields,
) satisfies Schema.Schema<PendingAuthenticatorPicker>

class LoginPickerSessionSchema {
  private static readonly awaitingFields = {
    kind: Schema.Literal(LoginPickerFrameBindingKind.AwaitingDocument),
  } satisfies Schema.Struct.Fields
  private static readonly boundFields = {
    kind: Schema.Literal(LoginPickerFrameBindingKind.Bound),
    frameId: Schema.Number.pipe(Schema.int(), Schema.positive()),
    documentId: Schema.String.pipe(Schema.minLength(1)),
  } satisfies Schema.Struct.Fields
  private static readonly fields = {
    ...pendingAuthenticatorPickerSchemaFields,
    parentDocumentId: Schema.String.pipe(Schema.minLength(1)),
    pickerDocument: Schema.Union(
      Schema.Struct(LoginPickerSessionSchema.awaitingFields),
      Schema.Struct(LoginPickerSessionSchema.boundFields),
    ),
  } satisfies Schema.Struct.Fields
  static readonly value = Schema.Struct(LoginPickerSessionSchema.fields)
}

class AccountPickerSessionCodec {
  decodeSessionAccounts(value: SessionAccountWireValue) {
    return Schema.decodeUnknown(sessionAccountsSchema)(value)
  }

  decodePendingAuthenticatorPicker(value: ExtensionSessionStorageValue) {
    return Schema.decodeUnknown(pendingAuthenticatorPickerSchema)(value)
  }

  decodePendingLoginPicker(value: ExtensionSessionStorageValue) {
    return Schema.decodeUnknown(LoginPickerSessionSchema.value)(value)
  }
}

export const accountPickerSessionCodec = new AccountPickerSessionCodec()
