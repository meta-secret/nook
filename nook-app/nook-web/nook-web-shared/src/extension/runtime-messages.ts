import {
  isExtensionConnectScope,
  type ExtensionConnectScope,
} from './extension-connect-scope'
import { ExtensionPairedVaultIdentityStatusMessageStatus } from './paired-vault-identity-status'

export { ExtensionPairedVaultIdentityStatusMessageStatus }

export enum ExtensionPairingVaultType {
  Simple = 'simple',
  Sentinel = 'sentinel',
}

export enum OpenSimpleVaultMessageType {
  NookOpenSimpleVault = 'nook:open-simple-vault',
}

export type OpenSimpleVaultMessage = {
  type: OpenSimpleVaultMessageType.NookOpenSimpleVault
}

export enum OpenCompanionLauncherMessageType {
  NookOpenCompanionLauncher = 'nook:open-companion-launcher',
}

export type OpenCompanionLauncherMessage = {
  type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
  payload?: {
    intent: 'pair'
  }
}

export enum BeginExtensionPairingMessageType {
  NookBeginExtensionPairing = 'nook:begin-extension-pairing',
}

export type BeginExtensionPairingMessage = {
  type: BeginExtensionPairingMessageType.NookBeginExtensionPairing
  payload: {
    deviceId: string
    devicePublicKey: string
    deviceSigningPublicKey: string
    deviceLabel: string
  }
}

export type ExtensionPairingApprovedGrant = {
  vaultType: ExtensionPairingVaultType.Simple
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
  deviceLabel: string
  vaultStoreId: string
  vaultName: string
  approvedAt: string
  scopes: ExtensionConnectScope[]
  providers: unknown[]
}

export type ExtensionEventLogRecord = {
  eventId: string
  path: string
  event: Record<string, unknown>
}

export enum ExtensionPairingApprovedMessageType {
  NookExtensionPairingApproved = 'nook:extension-pairing-approved',
}

export type ExtensionPairingApprovedMessage = {
  type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved
  payload: ExtensionPairingApprovedGrant
  eventLogRecords: ExtensionEventLogRecord[]
}

export enum ExtensionLocalEventLogUpdatedMessageType {
  NookExtensionLocalEventLogUpdated = 'nook:extension-local-event-log-updated',
}

export type ExtensionLocalEventLogUpdatedMessage = {
  type: ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated
  payload: {
    vaultStoreId: string
    eventLogRecords: ExtensionEventLogRecord[]
  }
}

export enum ExtensionIdentityHandoffRequestMessageType {
  NookExtensionIdentityHandoffRequest = 'nook:extension-identity-handoff-request',
}

export type ExtensionIdentityHandoffRequestMessage = {
  type: ExtensionIdentityHandoffRequestMessageType.NookExtensionIdentityHandoffRequest
  payload: {
    recipientPublicKey: string
    nonce: string
    expectedDeviceId: string
    expectedDevicePublicKey: string
    expectedDeviceSigningPublicKey: string
  }
}

export enum ExtensionPairedVaultIdentityDiscoveryMessageType {
  NookExtensionPairedVaultIdentityDiscovery = 'nook:extension-paired-vault-identity-discovery',
}

export type ExtensionPairedVaultIdentityDiscoveryMessage = {
  type: ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery
  payload: {
    requestId: string
    vaultStoreId: string
    expiresAt: number
  }
}

export enum ExtensionPairedVaultUnlockRequestMessageType {
  NookExtensionPairedVaultUnlockRequest = 'nook:extension-paired-vault-unlock-request',
}

export type ExtensionPairedVaultUnlockRequestMessage = {
  type: ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest
  payload: {
    requestId: string
    vaultStoreId: string
  }
}

type ExtensionPairedVaultIdentityStatusBase = {
  requestId: string
  vaultStoreId: string
}

export enum ExtensionPairedVaultIdentityStatusMessageType {
  NookExtensionPairedVaultIdentityStatus = 'nook:extension-paired-vault-identity-status',
}

export type ExtensionPairedVaultIdentityStatusMessage =
  | {
      type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus
      payload: ExtensionPairedVaultIdentityStatusBase & {
        status:
          | ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
          | ExtensionPairedVaultIdentityStatusMessageStatus.Locked
      }
    }
  | {
      type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus
      payload: ExtensionPairedVaultIdentityStatusBase & {
        status: ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
        connectedVaultStoreId: string
        connectedVaultName: string
      }
    }
  | {
      type: ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus
      payload: ExtensionPairedVaultIdentityStatusBase & {
        status: ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
        extensionRuntimeId: string
        deviceId: string
        devicePublicKey: string
        deviceSigningPublicKey: string
        deviceLabel: string
        nonce: string
        scopes: ExtensionConnectScope[]
      }
    }

export enum ExtensionPairedVaultIdentityHandoffRequestMessageType {
  NookExtensionPairedVaultIdentityHandoffRequest = 'nook:extension-paired-vault-identity-handoff-request',
}

export type ExtensionPairedVaultIdentityHandoffRequestMessage = {
  type: ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest
  payload: ExtensionIdentityHandoffRequestMessage['payload'] & {
    vaultStoreId: string
  }
}

export type RuntimeMessage =
  | OpenSimpleVaultMessage
  | OpenCompanionLauncherMessage
  | BeginExtensionPairingMessage
  | ExtensionIdentityHandoffRequestMessage
  | ExtensionPairedVaultIdentityDiscoveryMessage
  | ExtensionPairedVaultUnlockRequestMessage
  | ExtensionPairedVaultIdentityStatusMessage
  | ExtensionPairedVaultIdentityHandoffRequestMessage
  | ExtensionPairingApprovedMessage
  | ExtensionLocalEventLogUpdatedMessage

function isExtensionEventLogRecord(
  value: unknown,
): value is ExtensionEventLogRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.eventId === 'string' &&
    record.eventId.length > 0 &&
    typeof record.path === 'string' &&
    record.path.length > 0 &&
    Boolean(record.event) &&
    typeof record.event === 'object'
  )
}

function isExtensionEventLogRecords(
  value: unknown,
): value is ExtensionEventLogRecord[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isExtensionEventLogRecord)
  )
}

export function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  return (
    !!message &&
    typeof message === 'object' &&
    'type' in message &&
    typeof message.type === 'string'
  )
}

export function isOpenSimpleVaultMessage(
  message: unknown,
): message is OpenSimpleVaultMessage {
  return (
    isRuntimeMessage(message) &&
    message.type === OpenSimpleVaultMessageType.NookOpenSimpleVault
  )
}

export function isOpenCompanionLauncherMessage(
  message: unknown,
): message is OpenCompanionLauncherMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !== OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
  ) {
    return false
  }
  if (!('payload' in message)) return true
  const payload = message.payload
  return (
    !!payload &&
    typeof payload === 'object' &&
    'intent' in payload &&
    payload.intent === 'pair'
  )
}

export function isBeginExtensionPairingMessage(
  message: unknown,
): message is BeginExtensionPairingMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      BeginExtensionPairingMessageType.NookBeginExtensionPairing ||
    typeof (message as { payload?: unknown }).payload !== 'object' ||
    !(message as { payload?: unknown }).payload
  ) {
    return false
  }
  const payload = (message as { payload: Record<string, unknown> }).payload
  return (
    typeof payload.deviceId === 'string' &&
    payload.deviceId.length > 0 &&
    typeof payload.devicePublicKey === 'string' &&
    payload.devicePublicKey.length > 0 &&
    typeof payload.deviceSigningPublicKey === 'string' &&
    payload.deviceSigningPublicKey.length > 0 &&
    typeof payload.deviceLabel === 'string' &&
    payload.deviceLabel.length > 0
  )
}

export function isExtensionPairingApprovedMessage(
  message: unknown,
): message is ExtensionPairingApprovedMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      ExtensionPairingApprovedMessageType.NookExtensionPairingApproved ||
    typeof (message as { payload?: unknown }).payload !== 'object' ||
    !(message as { payload?: unknown }).payload
  ) {
    return false
  }

  const payload = (message as { payload: Record<string, unknown> }).payload
  return (
    isExtensionPairingApprovedGrant(payload) &&
    isExtensionEventLogRecords(
      (message as { eventLogRecords?: unknown }).eventLogRecords,
    )
  )
}

export function isExtensionIdentityHandoffRequestMessage(
  message: unknown,
): message is ExtensionIdentityHandoffRequestMessage {
  if (
    !isRuntimeMessage(message) ||
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

function isPairedVaultRequestMessage(
  message: unknown,
  type:
    | ExtensionPairedVaultIdentityDiscoveryMessage['type']
    | ExtensionPairedVaultUnlockRequestMessage['type'],
): boolean {
  if (
    !isRuntimeMessage(message) ||
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

export function isExtensionPairedVaultIdentityDiscoveryMessage(
  message: unknown,
): message is ExtensionPairedVaultIdentityDiscoveryMessage {
  return (
    isPairedVaultRequestMessage(
      message,
      ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
    ) &&
    typeof (message as ExtensionPairedVaultIdentityDiscoveryMessage).payload
      .expiresAt === 'number' &&
    Number.isFinite(
      (message as ExtensionPairedVaultIdentityDiscoveryMessage).payload
        .expiresAt,
    ) &&
    (message as ExtensionPairedVaultIdentityDiscoveryMessage).payload
      .expiresAt > Date.now()
  )
}

export function isExtensionPairedVaultUnlockRequestMessage(
  message: unknown,
): message is ExtensionPairedVaultUnlockRequestMessage {
  return isPairedVaultRequestMessage(
    message,
    ExtensionPairedVaultUnlockRequestMessageType.NookExtensionPairedVaultUnlockRequest,
  )
}

export function isExtensionPairedVaultIdentityStatusMessage(
  message: unknown,
): message is ExtensionPairedVaultIdentityStatusMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      ExtensionPairedVaultIdentityStatusMessageType.NookExtensionPairedVaultIdentityStatus ||
    typeof (message as { payload?: unknown }).payload !== 'object' ||
    !(message as { payload?: unknown }).payload
  ) {
    return false
  }
  const payload = (message as { payload: Record<string, unknown> }).payload
  if (
    typeof payload.requestId !== 'string' ||
    payload.requestId.length === 0 ||
    typeof payload.vaultStoreId !== 'string' ||
    payload.vaultStoreId.length === 0
  ) {
    return false
  }
  if (
    payload.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable ||
    payload.status === ExtensionPairedVaultIdentityStatusMessageStatus.Locked
  ) {
    return true
  }
  if (
    payload.status ===
    ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
  ) {
    return (
      typeof payload.connectedVaultStoreId === 'string' &&
      payload.connectedVaultStoreId.length > 0 &&
      typeof payload.connectedVaultName === 'string' &&
      payload.connectedVaultName.length > 0
    )
  }
  return (
    payload.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked &&
    typeof payload.extensionRuntimeId === 'string' &&
    payload.extensionRuntimeId.length > 0 &&
    typeof payload.deviceId === 'string' &&
    payload.deviceId.length > 0 &&
    typeof payload.devicePublicKey === 'string' &&
    payload.devicePublicKey.length > 0 &&
    typeof payload.deviceSigningPublicKey === 'string' &&
    payload.deviceSigningPublicKey.length > 0 &&
    typeof payload.deviceLabel === 'string' &&
    payload.deviceLabel.length > 0 &&
    typeof payload.nonce === 'string' &&
    payload.nonce.length > 0 &&
    Array.isArray(payload.scopes) &&
    payload.scopes.every((scope) => typeof scope === 'string')
  )
}

export function isExtensionPairedVaultIdentityHandoffRequestMessage(
  message: unknown,
): message is ExtensionPairedVaultIdentityHandoffRequestMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      ExtensionPairedVaultIdentityHandoffRequestMessageType.NookExtensionPairedVaultIdentityHandoffRequest ||
    typeof (message as { payload?: unknown }).payload !== 'object' ||
    !(message as { payload?: unknown }).payload
  ) {
    return false
  }
  const payload = (message as { payload: Record<string, unknown> }).payload
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
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

export function isExtensionPairingApprovedGrant(
  value: unknown,
): value is ExtensionPairingApprovedGrant {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return (
    payload.vaultType === ExtensionPairingVaultType.Simple &&
    typeof payload.deviceId === 'string' &&
    typeof payload.devicePublicKey === 'string' &&
    typeof payload.deviceSigningPublicKey === 'string' &&
    typeof payload.deviceLabel === 'string' &&
    typeof payload.vaultStoreId === 'string' &&
    typeof payload.vaultName === 'string' &&
    typeof payload.approvedAt === 'string' &&
    Array.isArray(payload.scopes) &&
    payload.scopes.every(isExtensionConnectScope) &&
    Array.isArray(payload.providers)
  )
}

export function isExtensionLocalEventLogUpdatedMessage(
  message: unknown,
): message is ExtensionLocalEventLogUpdatedMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated ||
    typeof (message as { payload?: unknown }).payload !== 'object' ||
    !(message as { payload?: unknown }).payload
  ) {
    return false
  }
  const payload = (message as { payload: Record<string, unknown> }).payload
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    isExtensionEventLogRecords(payload.eventLogRecords)
  )
}
