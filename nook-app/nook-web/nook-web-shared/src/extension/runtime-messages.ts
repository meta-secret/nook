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

export type RuntimeMessage =
  | PasswordFieldsDetectedMessage
  | GetTabSummaryMessage
  | ScanPasswordFieldsMessage

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
