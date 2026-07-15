export type OpenSimpleVaultMessage = {
  type: 'nook:open-simple-vault'
}

export type StartExtensionPairingMessage = {
  type: 'nook:start-extension-pairing'
}

export type ExtensionPairingApprovedGrant = {
  vaultType: 'simple'
  deviceId: string
  deviceLabel: string
  vaultStoreId: string
  vaultName: string
  approvedAt: string
  scopes: string[]
  providers: unknown[]
}

export type ExtensionPairingApprovedMessage = {
  type: 'nook:extension-pairing-approved'
  payload: ExtensionPairingApprovedGrant
}

export type RuntimeMessage =
  | OpenSimpleVaultMessage
  | StartExtensionPairingMessage
  | ExtensionPairingApprovedMessage

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

export function isStartExtensionPairingMessage(
  message: unknown,
): message is StartExtensionPairingMessage {
  return (
    isRuntimeMessage(message) &&
    message.type === 'nook:start-extension-pairing'
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
    payload.vaultType === 'simple' &&
    typeof payload.deviceId === 'string' &&
    typeof payload.deviceLabel === 'string' &&
    typeof payload.vaultStoreId === 'string' &&
    typeof payload.vaultName === 'string' &&
    typeof payload.approvedAt === 'string' &&
    Array.isArray(payload.scopes) &&
    payload.scopes.every((scope) => typeof scope === 'string') &&
    Array.isArray(payload.providers)
  )
}
