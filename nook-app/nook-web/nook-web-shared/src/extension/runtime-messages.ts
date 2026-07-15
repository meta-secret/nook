export type OpenSimpleVaultMessage = {
  type: 'nook:open-simple-vault'
}

export type BeginExtensionPairingMessage = {
  type: 'nook:begin-extension-pairing'
  payload: {
    deviceId: string
    devicePublicKey: string
    deviceSigningPublicKey: string
    deviceLabel: string
  }
}

export type ExtensionPairingApprovedGrant = {
  vaultType: 'simple'
  deviceId: string
  devicePublicKey: string
  deviceSigningPublicKey: string
  deviceLabel: string
  vaultStoreId: string
  vaultName: string
  approvedAt: string
  scopes: string[]
  providers: unknown[]
}

export type ExtensionEventLogRecord = {
  eventId: string
  path: string
  event: Record<string, unknown>
}

export type ExtensionPairingApprovedMessage = {
  type: 'nook:extension-pairing-approved'
  payload: ExtensionPairingApprovedGrant
  eventLogRecords: ExtensionEventLogRecord[]
}

export type ExtensionLocalEventLogUpdatedMessage = {
  type: 'nook:extension-local-event-log-updated'
  payload: {
    vaultStoreId: string
    eventLogRecords: ExtensionEventLogRecord[]
  }
}

/**
 * A one-time, in-memory transfer from the extension's isolated world to the
 * Simple Vault page. `identitySecret` is intentionally never serialized into
 * a URL or browser storage.
 */
export type ExtensionDeviceIdentityHandoffMessage = {
  type: 'nook:extension-device-identity-handoff'
  requestId: string
  payload: {
    identitySecret: string
  }
}

export type ExtensionDeviceIdentityHandoffResultMessage = {
  type: 'nook:extension-device-identity-handoff-result'
  requestId: string
  ok: boolean
}

export type RuntimeMessage =
  | OpenSimpleVaultMessage
  | BeginExtensionPairingMessage
  | ExtensionPairingApprovedMessage
  | ExtensionLocalEventLogUpdatedMessage
  | ExtensionDeviceIdentityHandoffMessage
  | ExtensionDeviceIdentityHandoffResultMessage

function isExtensionEventLogRecord(
  value: unknown,
): value is ExtensionEventLogRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.eventId === 'string' &&
    record.eventId.length > 0 &&
    typeof record.path === 'string' &&
    record.path.length > 0 &&
    typeof record.event === 'object' &&
    record.event !== null
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
  return isRuntimeMessage(message) && message.type === 'nook:open-simple-vault'
}

export function isBeginExtensionPairingMessage(
  message: unknown,
): message is BeginExtensionPairingMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !== 'nook:begin-extension-pairing' ||
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
    message.type !== 'nook:extension-pairing-approved' ||
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

export function isExtensionPairingApprovedGrant(
  value: unknown,
): value is ExtensionPairingApprovedGrant {
  if (typeof value !== 'object' || value === null) return false
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
    payload.scopes.every((scope) => typeof scope === 'string') &&
    Array.isArray(payload.providers)
  )
}

export function isExtensionLocalEventLogUpdatedMessage(
  message: unknown,
): message is ExtensionLocalEventLogUpdatedMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !== 'nook:extension-local-event-log-updated' ||
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

export function isExtensionDeviceIdentityHandoffMessage(
  message: unknown,
): message is ExtensionDeviceIdentityHandoffMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !== 'nook:extension-device-identity-handoff' ||
    typeof (message as { payload?: unknown }).payload !== 'object' ||
    !(message as { payload?: unknown }).payload
  ) {
    return false
  }
  const payload = (message as { payload: Record<string, unknown> }).payload
  return (
    typeof (message as { requestId?: unknown }).requestId === 'string' &&
    (message as { requestId: string }).requestId.length > 0 &&
    typeof payload.identitySecret === 'string' &&
    payload.identitySecret.length > 0
  )
}

export function isExtensionDeviceIdentityHandoffResultMessage(
  message: unknown,
): message is ExtensionDeviceIdentityHandoffResultMessage {
  return (
    isRuntimeMessage(message) &&
    message.type === 'nook:extension-device-identity-handoff-result' &&
    typeof (message as { requestId?: unknown }).requestId === 'string' &&
    (message as { requestId: string }).requestId.length > 0 &&
    typeof (message as { ok?: unknown }).ok === 'boolean'
  )
}
