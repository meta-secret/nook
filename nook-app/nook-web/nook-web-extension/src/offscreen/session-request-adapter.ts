import type {
  DeviceMode,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  ExtensionSessionRequestValidation,
  validateExtensionSessionRequestJson,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
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

export enum ExtensionSessionSensitiveStageKind {
  NotRequired = 'not-required',
  Staged = 'staged',
}

export type ExtensionSessionSensitiveStage =
  | { kind: ExtensionSessionSensitiveStageKind.NotRequired }
  | {
      kind: ExtensionSessionSensitiveStageKind.Staged
      request: ExtensionSessionRequest
    }

const sensitiveSessionFields: Readonly<
  Record<ExtensionSessionMessageType, readonly string[]>
> = {
  [ExtensionSessionMessageType.Reset]: [],
  [ExtensionSessionMessageType.MigrateAuthProviders]: [],
  [ExtensionSessionMessageType.Status]: [],
  [ExtensionSessionMessageType.BeginPasskeySetup]: [],
  [ExtensionSessionMessageType.FinishPasskeySetup]: [
    'credentialId',
    'userHandle',
    'prfInput',
    'prfOutput',
  ],
  [ExtensionSessionMessageType.RecoverPasskey]: [
    'credentialId',
    'userHandle',
    'prfOutput',
  ],
  [ExtensionSessionMessageType.UnlockOptions]: [],
  [ExtensionSessionMessageType.UnlockPasskey]: ['prfOutput'],
  [ExtensionSessionMessageType.CreatePin]: ['pin'],
  [ExtensionSessionMessageType.UnlockPin]: ['pin'],
  [ExtensionSessionMessageType.SealIdentityHandoff]: [],
  [ExtensionSessionMessageType.ImportVault]: [],
  [ExtensionSessionMessageType.UpdateVault]: [],
  [ExtensionSessionMessageType.ListPasskeys]: [],
  [ExtensionSessionMessageType.ListLogins]: [],
  [ExtensionSessionMessageType.RevealLogin]: [],
  [ExtensionSessionMessageType.ListAuthenticators]: [],
  [ExtensionSessionMessageType.AuthenticatorCode]: [],
  [ExtensionSessionMessageType.AuthenticatorEnrollPreview]: ['otpauthUri'],
  [ExtensionSessionMessageType.AuthenticatorEnrollCode]: ['otpauthUri'],
  [ExtensionSessionMessageType.AuthenticatorEnrollConfirm]: ['otpauthUri'],
  [ExtensionSessionMessageType.AuthenticatorBackupAttach]: ['codes'],
  [ExtensionSessionMessageType.PlanLoginSave]: ['password'],
  [ExtensionSessionMessageType.PendingLoginSave]: [],
  [ExtensionSessionMessageType.CommitLoginSave]: [],
  [ExtensionSessionMessageType.DismissLoginSave]: [],
  [ExtensionSessionMessageType.CancelPasskey]: [],
  [ExtensionSessionMessageType.RegisterPasskey]: [],
  [ExtensionSessionMessageType.AssertPasskey]: [],
  [ExtensionSessionMessageType.Lock]: [],
}

function clearSensitiveFieldValue(value: unknown): void {
  if (Array.isArray(value)) value.fill(0)
}

export function clearExtensionSessionSensitiveRequest(
  request: ExtensionSessionRequest,
): void {
  const payload = request.payload as Record<string, unknown>
  for (const field of sensitiveSessionFields[request.type]) {
    clearSensitiveFieldValue(payload[field])
    payload[field] = typeof payload[field] === 'string' ? '' : []
  }
}

export function stageExtensionSessionSensitiveRequest(
  request: ExtensionSessionRequest,
): ExtensionSessionSensitiveStage {
  const fields = sensitiveSessionFields[request.type]
  if (fields.length === 0) {
    return { kind: ExtensionSessionSensitiveStageKind.NotRequired }
  }
  const sourcePayload = request.payload as Record<string, unknown>
  const stagedPayload = { ...sourcePayload }
  for (const field of fields) {
    const value = sourcePayload[field]
    stagedPayload[field] = Array.isArray(value) ? [...value] : value
    clearSensitiveFieldValue(value)
    sourcePayload[field] = typeof value === 'string' ? '' : []
  }
  const replacementArgs: Parameters<
    typeof replaceExtensionSessionRequestPayload
  >[0] = {
    request,
    payload: stagedPayload,
  }
  return {
    kind: ExtensionSessionSensitiveStageKind.Staged,
    request: replaceExtensionSessionRequestPayload(replacementArgs),
  }
}

export async function parseExtensionSessionRequest(
  value: unknown,
): Promise<ExtensionSessionRequestParse> {
  try {
    await companionWasmReady
    const serialized = JSON.stringify(value)
    if (
      typeof serialized !== 'string' ||
      validateExtensionSessionRequestJson(serialized) !==
        ExtensionSessionRequestValidation.Accepted
    ) {
      return { kind: ExtensionSessionRequestParseKind.Invalid }
    }
  } catch {
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
