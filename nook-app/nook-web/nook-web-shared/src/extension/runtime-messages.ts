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

export type ExtensionIdentityHandoffRequestMessage = {
  type: 'nook:extension-identity-handoff-request'
  payload: {
    recipientPublicKey: string
    nonce: string
    expectedDeviceId: string
    expectedDevicePublicKey: string
    expectedDeviceSigningPublicKey: string
  }
}

export type RuntimeMessage =
  | OpenSimpleVaultMessage
  | BeginExtensionPairingMessage
  | ExtensionIdentityHandoffRequestMessage
  | ExtensionPairingApprovedMessage
  | ExtensionLocalEventLogUpdatedMessage

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

export function isExtensionIdentityHandoffRequestMessage(
  message: unknown,
): message is ExtensionIdentityHandoffRequestMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !== 'nook:extension-identity-handoff-request' ||
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
