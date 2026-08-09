import type {
  DeviceMode,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'

type QueueMetadata = {
  queueExpiresAt?: number
  queuePriority?: 'interactive'
}

type VaultGrant = {
  vaultStoreId: string
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
}

type EmptyPayload = QueueMetadata
type FinishPasskeySetupPayload = QueueMetadata & {
  credentialId: number[]
  userHandle: number[]
  prfInput: number[]
  prfOutput: number[]
  deviceMode: DeviceMode
}
type RecoverPasskeyPayload = QueueMetadata & {
  credentialId: number[]
  userHandle: number[]
  prfOutput: number[]
}
type PinPayload = QueueMetadata & { pin: string }
type UnlockPasskeyPayload = QueueMetadata & { prfOutput: number[] }
type IdentityHandoffPayload = QueueMetadata & {
  recipientPublicKey: string
  nonce: string
  expectedDeviceId: string
  expectedDevicePublicKey: string
  expectedDeviceSigningPublicKey: string
}
type ImportVaultPayload = QueueMetadata &
  VaultGrant & {
    providers: StorageProvider[]
    eventLogRecords: object[]
  }
type UpdateVaultPayload = QueueMetadata &
  VaultGrant & { eventLogRecords: object[] }
type PasskeyLookupPayload = QueueMetadata &
  VaultGrant & { rpId: string; origin: string }
type OriginGrantPayload = QueueMetadata & VaultGrant & { origin: string }
type SecretGrantPayload = QueueMetadata &
  VaultGrant & { origin: string; secretId: string }
type QueryGrantPayload = QueueMetadata & VaultGrant & { query: string }
type SecretIdGrantPayload = QueueMetadata & VaultGrant & { secretId: string }
type OtpauthPayload = QueueMetadata & { otpauthUri: string }
type OtpauthGrantPayload = QueueMetadata &
  VaultGrant & { otpauthUri: string; origin: string }
type BackupAttachPayload = QueueMetadata &
  VaultGrant & { secretId: string; codes: string[]; mode: string }
type LoginSavePlanPayload = QueueMetadata &
  VaultGrant & { origin: string; username: string; password: string }
type OriginPayload = QueueMetadata & { origin: string }
type LoginSaveActionPayload = QueueMetadata &
  Partial<VaultGrant> & { origin: string; offerId: string }
type RequestPayload = QueueMetadata & { requestId: string }
type PasskeyCeremonyPayload = QueueMetadata &
  VaultGrant & { requestId: string; requestJson: string }

export type ExtensionSessionRequest =
  | { type: ExtensionSessionMessageType.Reset; payload: EmptyPayload }
  | {
      type: ExtensionSessionMessageType.MigrateAuthProviders
      payload: EmptyPayload
    }
  | { type: ExtensionSessionMessageType.Status; payload: EmptyPayload }
  | {
      type: ExtensionSessionMessageType.BeginPasskeySetup
      payload: EmptyPayload
    }
  | {
      type: ExtensionSessionMessageType.FinishPasskeySetup
      payload: FinishPasskeySetupPayload
    }
  | {
      type: ExtensionSessionMessageType.RecoverPasskey
      payload: RecoverPasskeyPayload
    }
  | { type: ExtensionSessionMessageType.UnlockOptions; payload: EmptyPayload }
  | {
      type: ExtensionSessionMessageType.UnlockPasskey
      payload: UnlockPasskeyPayload
    }
  | { type: ExtensionSessionMessageType.CreatePin; payload: PinPayload }
  | { type: ExtensionSessionMessageType.UnlockPin; payload: PinPayload }
  | {
      type: ExtensionSessionMessageType.SealIdentityHandoff
      payload: IdentityHandoffPayload
    }
  | {
      type: ExtensionSessionMessageType.ImportVault
      payload: ImportVaultPayload
    }
  | {
      type: ExtensionSessionMessageType.UpdateVault
      payload: UpdateVaultPayload
    }
  | {
      type: ExtensionSessionMessageType.ListPasskeys
      payload: PasskeyLookupPayload
    }
  | {
      type: ExtensionSessionMessageType.ListLogins
      payload: OriginGrantPayload
    }
  | {
      type: ExtensionSessionMessageType.RevealLogin
      payload: SecretGrantPayload
    }
  | {
      type: ExtensionSessionMessageType.ListAuthenticators
      payload: QueryGrantPayload
    }
  | {
      type: ExtensionSessionMessageType.AuthenticatorCode
      payload: SecretIdGrantPayload
    }
  | {
      type: ExtensionSessionMessageType.AuthenticatorEnrollPreview
      payload: OtpauthPayload
    }
  | {
      type: ExtensionSessionMessageType.AuthenticatorEnrollCode
      payload: OtpauthPayload
    }
  | {
      type: ExtensionSessionMessageType.AuthenticatorEnrollConfirm
      payload: OtpauthGrantPayload
    }
  | {
      type: ExtensionSessionMessageType.AuthenticatorBackupAttach
      payload: BackupAttachPayload
    }
  | {
      type: ExtensionSessionMessageType.PlanLoginSave
      payload: LoginSavePlanPayload
    }
  | {
      type: ExtensionSessionMessageType.PendingLoginSave
      payload: OriginPayload
    }
  | {
      type: ExtensionSessionMessageType.CommitLoginSave
      payload: LoginSaveActionPayload & VaultGrant
    }
  | {
      type: ExtensionSessionMessageType.DismissLoginSave
      payload: LoginSaveActionPayload
    }
  | { type: ExtensionSessionMessageType.CancelPasskey; payload: RequestPayload }
  | {
      type: ExtensionSessionMessageType.RegisterPasskey
      payload: PasskeyCeremonyPayload
    }
  | {
      type: ExtensionSessionMessageType.AssertPasskey
      payload: PasskeyCeremonyPayload
    }
  | { type: ExtensionSessionMessageType.Lock; payload: EmptyPayload }

export enum ExtensionSessionRequestParseKind {
  Invalid = 'invalid',
  Parsed = 'parsed',
}

export type ExtensionSessionRequestParse =
  | { kind: ExtensionSessionRequestParseKind.Invalid }
  | {
      kind: ExtensionSessionRequestParseKind.Parsed
      request: ExtensionSessionRequest
    }

enum FieldKind {
  String = 'string',
  Number = 'number',
  NumberArray = 'number-array',
  StringArray = 'string-array',
  Array = 'array',
}

type RequiredField = { name: string; kind: FieldKind }

const stringField = (name: string): RequiredField => ({
  name,
  kind: FieldKind.String,
})
const numberField = (name: string): RequiredField => ({
  name,
  kind: FieldKind.Number,
})
const numberArrayField = (name: string): RequiredField => ({
  name,
  kind: FieldKind.NumberArray,
})
const stringArrayField = (name: string): RequiredField => ({
  name,
  kind: FieldKind.StringArray,
})
const arrayField = (name: string): RequiredField => ({
  name,
  kind: FieldKind.Array,
})

const grantFields = [
  stringField('vaultStoreId'),
  stringField('deviceId'),
  stringField('devicePublicKey'),
  stringField('deviceSigningPublicKey'),
]

const requestFields: Readonly<
  Record<ExtensionSessionMessageType, readonly RequiredField[]>
> = {
  [ExtensionSessionMessageType.Reset]: [],
  [ExtensionSessionMessageType.MigrateAuthProviders]: [],
  [ExtensionSessionMessageType.Status]: [],
  [ExtensionSessionMessageType.BeginPasskeySetup]: [],
  [ExtensionSessionMessageType.FinishPasskeySetup]: [
    numberArrayField('credentialId'),
    numberArrayField('userHandle'),
    numberArrayField('prfInput'),
    numberArrayField('prfOutput'),
    numberField('deviceMode'),
  ],
  [ExtensionSessionMessageType.RecoverPasskey]: [
    numberArrayField('credentialId'),
    numberArrayField('userHandle'),
    numberArrayField('prfOutput'),
  ],
  [ExtensionSessionMessageType.UnlockOptions]: [],
  [ExtensionSessionMessageType.UnlockPasskey]: [numberArrayField('prfOutput')],
  [ExtensionSessionMessageType.CreatePin]: [stringField('pin')],
  [ExtensionSessionMessageType.UnlockPin]: [stringField('pin')],
  [ExtensionSessionMessageType.SealIdentityHandoff]: [
    stringField('recipientPublicKey'),
    stringField('nonce'),
    stringField('expectedDeviceId'),
    stringField('expectedDevicePublicKey'),
    stringField('expectedDeviceSigningPublicKey'),
  ],
  [ExtensionSessionMessageType.ImportVault]: [
    ...grantFields,
    arrayField('providers'),
    arrayField('eventLogRecords'),
  ],
  [ExtensionSessionMessageType.UpdateVault]: [
    ...grantFields,
    arrayField('eventLogRecords'),
  ],
  [ExtensionSessionMessageType.ListPasskeys]: [
    ...grantFields,
    stringField('rpId'),
    stringField('origin'),
  ],
  [ExtensionSessionMessageType.ListLogins]: [
    ...grantFields,
    stringField('origin'),
  ],
  [ExtensionSessionMessageType.RevealLogin]: [
    ...grantFields,
    stringField('origin'),
    stringField('secretId'),
  ],
  [ExtensionSessionMessageType.ListAuthenticators]: [
    ...grantFields,
    stringField('query'),
  ],
  [ExtensionSessionMessageType.AuthenticatorCode]: [
    ...grantFields,
    stringField('secretId'),
  ],
  [ExtensionSessionMessageType.AuthenticatorEnrollPreview]: [
    stringField('otpauthUri'),
  ],
  [ExtensionSessionMessageType.AuthenticatorEnrollCode]: [
    stringField('otpauthUri'),
  ],
  [ExtensionSessionMessageType.AuthenticatorEnrollConfirm]: [
    ...grantFields,
    stringField('otpauthUri'),
    stringField('origin'),
  ],
  [ExtensionSessionMessageType.AuthenticatorBackupAttach]: [
    ...grantFields,
    stringField('secretId'),
    stringArrayField('codes'),
    stringField('mode'),
  ],
  [ExtensionSessionMessageType.PlanLoginSave]: [
    ...grantFields,
    stringField('origin'),
    stringField('username'),
    stringField('password'),
  ],
  [ExtensionSessionMessageType.PendingLoginSave]: [stringField('origin')],
  [ExtensionSessionMessageType.CommitLoginSave]: [
    ...grantFields,
    stringField('origin'),
    stringField('offerId'),
  ],
  [ExtensionSessionMessageType.DismissLoginSave]: [
    stringField('origin'),
    stringField('offerId'),
  ],
  [ExtensionSessionMessageType.CancelPasskey]: [stringField('requestId')],
  [ExtensionSessionMessageType.RegisterPasskey]: [
    ...grantFields,
    stringField('requestId'),
    stringField('requestJson'),
  ],
  [ExtensionSessionMessageType.AssertPasskey]: [
    ...grantFields,
    stringField('requestId'),
    stringField('requestJson'),
  ],
  [ExtensionSessionMessageType.Lock]: [],
}

const sessionMessageTypes = new Set<string>(
  Object.values(ExtensionSessionMessageType),
)

function validField(
  payload: Record<string, unknown>,
  field: RequiredField,
): boolean {
  const value = payload[field.name]
  switch (field.kind) {
    case FieldKind.String:
      return typeof value === 'string'
    case FieldKind.Number:
      return typeof value === 'number' && Number.isFinite(value)
    case FieldKind.NumberArray:
      return (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'number')
      )
    case FieldKind.StringArray:
      return (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string')
      )
    case FieldKind.Array:
      return Array.isArray(value)
  }
}

export function parseExtensionSessionRequest(
  value: unknown,
): ExtensionSessionRequestParse {
  if (
    !value ||
    typeof value !== 'object' ||
    !('type' in value) ||
    !('payload' in value)
  ) {
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  }
  if (typeof value.type !== 'string' || !sessionMessageTypes.has(value.type)) {
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  }
  if (
    !value.payload ||
    typeof value.payload !== 'object' ||
    Array.isArray(value.payload)
  ) {
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  }
  const type = value.type as ExtensionSessionMessageType
  const payload = value.payload as Record<string, unknown>
  if (!requestFields[type].every((field) => validField(payload, field))) {
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  }
  if (
    ('queueExpiresAt' in payload &&
      (typeof payload.queueExpiresAt !== 'number' ||
        !Number.isFinite(payload.queueExpiresAt))) ||
    ('queuePriority' in payload && payload.queuePriority !== 'interactive')
  ) {
    return { kind: ExtensionSessionRequestParseKind.Invalid }
  }
  return {
    kind: ExtensionSessionRequestParseKind.Parsed,
    request: value as ExtensionSessionRequest,
  }
}

export function replaceExtensionSessionRequestPayload({
  request,
  payload,
}: {
  request: ExtensionSessionRequest
  payload: object
}): ExtensionSessionRequest {
  return { ...request, payload } as ExtensionSessionRequest
}
