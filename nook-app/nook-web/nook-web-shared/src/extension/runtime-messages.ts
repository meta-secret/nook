import { err, ok, type Result } from 'neverthrow'
import type {
  ExtensionStorageProviderIdentity,
  ExtensionPairingGrantApproval,
  ExtensionStorageProviderType as RustExtensionStorageProviderType,
} from './nook-companion-wasm/nook_companion_wasm.js'
import { ExtensionConnectScope } from './extension-connect-scope'

import { ExtensionPairedVaultIdentityStatusMessageStatus } from './paired-vault-identity-status'

import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
  type OpenCompanionLauncherMessage,
} from './companion-launcher-message'

import { OpenCompanionLauncherMessage as OpenCompanionLauncherMessageSchema } from './companion-launcher-message'

import {
  BeginExtensionPairingMessageType,
  ExtensionLocalEventLogUpdatedMessageType,
  OpenSimpleVaultMessageType,
  type BeginExtensionPairingMessage,
  type ExtensionEventLogRecord,
  type ExtensionLocalEventLogUpdatedMessage,
  type OpenSimpleVaultMessage,
} from './lifecycle-runtime-messages'

import {
  RuntimeMessageEnvelope as RuntimeMessageEnvelopeSchema,
  BeginExtensionPairingMessage as BeginExtensionPairingMessageSchema,
  ExtensionLocalEventLogUpdatedMessage as ExtensionLocalEventLogUpdatedMessageSchema,
  OpenSimpleVaultMessage as OpenSimpleVaultMessageSchema,
} from './lifecycle-runtime-messages'

export {
  BeginExtensionPairingMessageType,
  ExtensionLocalEventLogUpdatedMessageType,
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
  OpenSimpleVaultMessageType,
  BeginExtensionPairingMessageSchema as BeginExtensionPairingMessage,
  type ExtensionEventLogRecord,
  ExtensionLocalEventLogUpdatedMessageSchema as ExtensionLocalEventLogUpdatedMessage,
  OpenCompanionLauncherMessageSchema as OpenCompanionLauncherMessage,
  OpenSimpleVaultMessageSchema as OpenSimpleVaultMessage,
}

export { ExtensionPairedVaultIdentityStatusMessageStatus }

export type { ExtensionPairingVaultType } from './nook-companion-wasm/nook_companion_wasm.js'

export enum GeneratePasswordRequestType {
  NookWebsiteGeneratePassword = 'nook:website-generate-password',
}

export type GeneratePasswordRequest = {
  readonly type: GeneratePasswordRequestType.NookWebsiteGeneratePassword
  readonly payload: { origin: string }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export type ExtensionPairingApprovedGrant = Omit<
  ExtensionPairingGrantApproval,
  'syncProviderCount' | 'vaultType'
> & {
  vaultType: 'simple'
  providers: ExtensionStorageProviderPayload[]
}
export class ExtensionPairingApprovedGrantAdmission {
  private constructor() {}
  static is(value: unknown): value is ExtensionPairingApprovedGrant {
    if (!value || typeof value !== 'object') return false
    const payload = value as Record<string, unknown>
    return (
      payload.vaultType === 'simple' &&
      typeof payload.deviceId === 'string' &&
      typeof payload.devicePublicKey === 'string' &&
      typeof payload.deviceSigningPublicKey === 'string' &&
      typeof payload.deviceLabel === 'string' &&
      typeof payload.vaultStoreId === 'string' &&
      typeof payload.vaultName === 'string' &&
      typeof payload.approvedAt === 'string' &&
      Array.isArray(payload.scopes) &&
      payload.scopes.every(
        ExtensionConnectScope.isExtensionConnectScopeValue.bind(
          ExtensionConnectScope,
        ),
      ) &&
      Array.isArray(payload.providers) &&
      payload.providers.every((provider) =>
        new ExtensionStorageProviderPayloadAdmission(provider).parse().isOk(),
      )
    )
  }
}

export type ExtensionStorageProviderType = RustExtensionStorageProviderType
export const ExtensionStorageProviderType = {
  Local: 'local',
  LocalFolder: 'local-folder',
  Github: 'github',
  OAuthFile: 'oauth-file',
} satisfies Record<string, RustExtensionStorageProviderType>
export type ExtensionStorageProviderPayload = ExtensionStorageProviderIdentity
/** Structural browser wire value; validation requires no instance methods or runtime state. */
export enum ExtensionStorageProviderIdentityFailure {
  Invalid = 'invalid-provider-identity',
}
export class ExtensionStorageProviderPayloadAdmission {
  constructor(private readonly value: unknown) {}
  parse(): Result<
    ExtensionStorageProviderPayload,
    ExtensionStorageProviderIdentityFailure
  > {
    const value = this.value
    if (!value || typeof value !== 'object')
      return err(ExtensionStorageProviderIdentityFailure.Invalid)
    const provider = value as Record<string, unknown>
    if (typeof provider.id !== 'string' || provider.id.length === 0)
      return err(ExtensionStorageProviderIdentityFailure.Invalid)
    switch (provider.type) {
      case ExtensionStorageProviderType.Local:
      case ExtensionStorageProviderType.LocalFolder:
      case ExtensionStorageProviderType.Github:
      case ExtensionStorageProviderType.OAuthFile:
        return ok({ id: provider.id, type: provider.type })
      default:
        return err(ExtensionStorageProviderIdentityFailure.Invalid)
    }
  }
}

export enum ExtensionPairingApprovedMessageType {
  NookExtensionPairingApproved = 'nook:extension-pairing-approved',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairingApprovedMessage {
  static isExtensionEventLogRecord(
    value: unknown,
  ): value is ExtensionEventLogRecord {
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    return (
      typeof record.eventId === 'string' &&
      record.eventId.length > 0 &&
      typeof record.path === 'string' &&
      record.path.length > 0 &&
      ExtensionPairingApprovedMessage.isExtensionEventObject(record.event) &&
      'schema_version' in record.event &&
      typeof record.event.schema_version === 'number'
    )
  }
  static isExtensionEventObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object'
  }
  static isExtensionEventLogRecords(
    value: unknown,
  ): value is ExtensionEventLogRecord[] {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(ExtensionPairingApprovedMessage.isExtensionEventLogRecord)
    )
  }
  private constructor() {}
  declare readonly type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved
  declare readonly payload: ExtensionPairingApprovedGrant
  declare readonly eventLogRecords: ExtensionEventLogRecord[]
  static is(message: unknown): message is ExtensionPairingApprovedMessage {
    if (
      !RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) ||
      message.type !==
        ExtensionPairingApprovedMessageType.NookExtensionPairingApproved ||
      typeof (message as { payload?: unknown }).payload !== 'object' ||
      !(message as { payload?: unknown }).payload
    ) {
      return false
    }

    const payload = (message as { payload: Record<string, unknown> }).payload
    return (
      ExtensionPairingApprovedGrant.is(payload) &&
      ExtensionPairingApprovedMessage.isExtensionEventLogRecords(
        (message as { eventLogRecords?: unknown }).eventLogRecords,
      )
    )
  }
}

export enum ExtensionIdentityHandoffRequestMessageType {
  NookExtensionIdentityHandoffRequest = 'nook:extension-identity-handoff-request',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionIdentityHandoffRequestMessage {
  private constructor() {}
  declare readonly type: ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest
  declare readonly payload: {
    recipientPublicKey: string
    nonce: string
    expectedDeviceId: string
    expectedDevicePublicKey: string
    expectedDeviceSigningPublicKey: string
  }
  static is(message: unknown): message is ExtensionIdentityHandoffRequestMessage {
    if (
      !RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) ||
      message.type !==
        ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest ||
      typeof (message as { payload?: unknown }).payload !== 'object' ||
      !(message as { payload?: unknown }).payload
    ) {
      return false
    }
    const payload = (message as { payload: Record<string, unknown> }).payload
    return (
      typeof payload.recipientPublicKey === 'string' &&
      payload.recipientPublicKey.length > 0 &&
      typeof payload.nonce === 'string' &&
      payload.nonce.length > 0 &&
      typeof payload.expectedDeviceId === 'string' &&
      payload.expectedDeviceId.length > 0 &&
      typeof payload.expectedDevicePublicKey === 'string' &&
      payload.expectedDevicePublicKey.length > 0 &&
      typeof payload.expectedDeviceSigningPublicKey === 'string' &&
      payload.expectedDeviceSigningPublicKey.length > 0
    )
  }
}

export enum ExtensionPairedVaultIdentityDiscoveryMessageType {
  NookExtensionPairedVaultIdentityDiscovery = 'nook:extension-paired-vault-identity-discovery',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairedVaultIdentityDiscoveryMessage {
  private constructor() {}
  declare readonly type: ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery
  declare readonly payload: unknown
  static is(
    message: unknown,
  ): message is ExtensionPairedVaultIdentityDiscoveryMessage {
    return (
      RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) &&
      message.type ===
        ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery &&
      'payload' in message
    )
  }
}

export type CompanionIdentityDiscoveryTransportResponse =
  | { ok: true; status: unknown }
  | { ok: false }

export enum ExtensionPairedVaultUnlockRequestMessageType {
  NookExtensionPairedVaultUnlockRequest = 'nook:extension-paired-vault-unlock-request',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairedVaultUnlockRequestMessage {
  static isPairedVaultRequestMessage({
    message,
    type,
  }: IsPairedVaultRequestMessageArgs): boolean {
    if (
      !RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) ||
      message.type !== type ||
      typeof (message as { payload?: unknown }).payload !== 'object' ||
      !(message as { payload?: unknown }).payload
    ) {
      return false
    }
    const payload = (message as { payload: Record<string, unknown> }).payload
    return (
      typeof payload.requestId === 'string' &&
      payload.requestId.length > 0 &&
      typeof payload.vaultStoreId === 'string' &&
      payload.vaultStoreId.length > 0
    )
  }
  private constructor() {}
  declare readonly type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest
  declare readonly payload: {
    requestId: string
    vaultStoreId: string
  }
  static is(message: unknown): message is ExtensionPairedVaultUnlockRequestMessage {
    const nookTypedArgs0_0: Parameters<
      typeof ExtensionPairedVaultUnlockRequestMessage.isPairedVaultRequestMessage
    >[0] = {
      message,
      type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
    }
    return ExtensionPairedVaultUnlockRequestMessage.isPairedVaultRequestMessage(
      nookTypedArgs0_0,
    )
  }
}

export enum ExtensionPairedVaultIdentityHandoffRequestMessageType {
  NookExtensionPairedVaultIdentityHandoffRequest = 'nook:extension-paired-vault-identity-handoff-request',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class ExtensionPairedVaultIdentityHandoffRequestMessage {
  private constructor() {}
  declare readonly type: ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest
  declare readonly payload: unknown
  static is(
    message: unknown,
  ): message is ExtensionPairedVaultIdentityHandoffRequestMessage {
    if (
      !RuntimeMessageEnvelopeSchema.hasRuntimeMessageType(message) ||
      message.type !==
        ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest ||
      !('payload' in message)
    ) {
      return false
    }
    return true
  }
}

export type CompanionIdentityHandoffTransportResponse =
  | { ok: true; response: unknown }
  | { ok: false; reason: string }

export type RuntimeMessage =
  | OpenSimpleVaultMessage
  | OpenCompanionLauncherMessage
  | BeginExtensionPairingMessage
  | ExtensionIdentityHandoffRequestMessage
  | ExtensionPairedVaultIdentityDiscoveryMessage
  | ExtensionPairedVaultUnlockRequestMessage
  | ExtensionPairedVaultIdentityHandoffRequestMessage
  | ExtensionPairingApprovedMessage
  | ExtensionLocalEventLogUpdatedMessage

type IsPairedVaultRequestMessageArgs = {
  message: unknown
  type: ExtensionPairedVaultUnlockRequestMessage['type']
}

export const ExtensionStorageProviderPayload =
  ExtensionStorageProviderPayloadAdmission

export const ExtensionPairingApprovedGrant = ExtensionPairingApprovedGrantAdmission
