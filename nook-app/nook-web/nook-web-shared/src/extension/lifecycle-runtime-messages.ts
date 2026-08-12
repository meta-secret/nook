import type { ExtensionVaultEventPayload } from './nook-companion-wasm/nook_companion_wasm'

export enum OpenSimpleVaultMessageType {
  NookOpenSimpleVault = 'nook:open-simple-vault',
}

export type OpenSimpleVaultMessage = {
  type: OpenSimpleVaultMessageType.NookOpenSimpleVault
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

export type ExtensionEventLogRecord = {
  eventId: string
  path: string
  event: ExtensionVaultEventPayload
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

export function isRuntimeMessage(
  message: unknown,
): message is { type: string } {
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

export function isBeginExtensionPairingMessage(
  message: unknown,
): message is BeginExtensionPairingMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !== BeginExtensionPairingMessageType.NookBeginExtensionPairing ||
    !('payload' in message) ||
    typeof message.payload !== 'object' ||
    !message.payload
  ) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
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
    !!record.event &&
    typeof record.event === 'object' &&
    'schema_version' in record.event &&
    typeof record.event.schema_version === 'number'
  )
}

export function isExtensionLocalEventLogUpdatedMessage(
  message: unknown,
): message is ExtensionLocalEventLogUpdatedMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !==
      ExtensionLocalEventLogUpdatedMessageType.NookExtensionLocalEventLogUpdated ||
    !('payload' in message) ||
    typeof message.payload !== 'object' ||
    !message.payload
  ) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  return (
    typeof payload.vaultStoreId === 'string' &&
    payload.vaultStoreId.length > 0 &&
    Array.isArray(payload.eventLogRecords) &&
    payload.eventLogRecords.length > 0 &&
    payload.eventLogRecords.every(isExtensionEventLogRecord)
  )
}
