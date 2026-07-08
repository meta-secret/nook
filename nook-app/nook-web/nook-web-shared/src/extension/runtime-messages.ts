import type { PasswordFormSummary } from './password-forms'

export type { PasswordFormSummary } from './password-forms'

export type TabPasswordFormSummary = PasswordFormSummary & {
  tabId: number
  url?: string
  title?: string
}

export type PasswordFieldsDetectedMessage = {
  type: 'nook:password-fields-detected'
  payload: PasswordFormSummary
}

export type GetTabSummaryMessage = {
  type: 'nook:get-tab-summary'
  tabId: number
}

export type ScanPasswordFieldsMessage = {
  type: 'nook:scan-password-fields'
}

export type ExtensionPairingApprovedGrant = {
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
  | PasswordFieldsDetectedMessage
  | GetTabSummaryMessage
  | ScanPasswordFieldsMessage
  | ExtensionPairingApprovedMessage

export type ScanPasswordFieldsResponse = {
  ok: boolean
  summary?: PasswordFormSummary
}

export function tabStorageKey(tabId: number) {
  return `tab:${tabId}:password-form-summary`
}

export function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof message.type === 'string'
  )
}

export function isScanPasswordFieldsMessage(
  message: unknown,
): message is ScanPasswordFieldsMessage {
  return isRuntimeMessage(message) && message.type === 'nook:scan-password-fields'
}

export function isExtensionPairingApprovedMessage(
  message: unknown,
): message is ExtensionPairingApprovedMessage {
  if (
    !isRuntimeMessage(message) ||
    message.type !== 'nook:extension-pairing-approved' ||
    typeof (message as { payload?: unknown }).payload !== 'object' ||
    (message as { payload?: unknown }).payload === null
  ) {
    return false
  }

  const payload = (message as { payload: Record<string, unknown> }).payload
  return (
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
