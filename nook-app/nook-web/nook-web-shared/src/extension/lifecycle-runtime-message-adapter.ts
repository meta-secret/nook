import {
  BeginExtensionPairingMessageType,
  ExtensionLocalEventLogUpdatedMessageType,
  OpenSimpleVaultMessageType,
  type BeginExtensionPairingMessage,
  type ExtensionEventLogRecord,
  type ExtensionLocalEventLogUpdatedMessage,
  type OpenSimpleVaultMessage,
} from './lifecycle-runtime-messages'

export function hasRuntimeMessageType(
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
    hasRuntimeMessageType(message) &&
    message.type === OpenSimpleVaultMessageType.NookOpenSimpleVault
  )
}

export function isBeginExtensionPairingMessage(
  message: unknown,
): message is BeginExtensionPairingMessage {
  if (
    !hasRuntimeMessageType(message) ||
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
    !hasRuntimeMessageType(message) ||
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
