import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'
import { compactProgressState } from '../../lib/auth-widget-policy'
import type { AuthenticationWorkflowSnapshotView } from '../../lib/auth-workflow-messages'
import type { WebsiteLoginAccountOption } from '../../lib/login-fill-messages'
import {
  ExtensionSetupLoadKind,
  loadExtensionSetupState,
} from '../../lib/pairing-state'
import { WidgetHostKind, saveOfferState, widgetState } from './state'

export type PilotVaultConnection = {
  connected: boolean
  vaultName?: string
}

export const WIDGET_HOST_ID = 'nook-auth-widget'

export const DRAG_THRESHOLD_PX = 4

export const MAX_WORKFLOW_OBSERVATIONS = 20

export const OUTCOME_EVIDENCE_TIMEOUT_MS = 8_000

export const OUTCOME_EVIDENCE_POLL_MS = 250

export enum LoginOptionsResponseStatus {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

export type LoginOptionsResponse = {
  ok?: boolean
  status?:
    | LoginOptionsResponseStatus.Ready
    | LoginOptionsResponseStatus.Locked
    | LoginOptionsResponseStatus.Unavailable
  accounts?: WebsiteLoginAccountOption[]
  reason?: string
}

export type LoginFillResponse = {
  ok?: boolean
  username?: string
  password?: string
  reason?: string
}

export type WorkflowSnapshotResponse = {
  ok?: boolean
  snapshot?: AuthenticationWorkflowSnapshotView
  reason?: string
}

export type WorkflowCopy = {
  titleKey: BrowserMessageKey
  descriptionKey: BrowserMessageKey
}

export function workflowCopy(kind: string): WorkflowCopy {
  switch (kind) {
    case 'login':
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetLoginDescription,
      }
    case 'signup':
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetSignupTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetSignupDescription,
      }
    case 'password-change':
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetPasswordChangeTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetPasswordChangeDescription,
      }
    case 'totp-challenge':
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorDescription,
      }
    default:
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetManualTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetManualDescription,
      }
  }
}

export function progressLabel(currentStep: number, totalSteps: number): string {
  return `${translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPilotLabel)} · ${currentStep}/${totalSteps}`
}

export function setFlightProgress(
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  currentStep: number,
  totalSteps: number,
  titleKey: BrowserMessageKey,
): void {
  step.textContent = progressLabel(currentStep, totalSteps)
  title.textContent = translatedMessage(titleKey)
  const root = step.getRootNode()
  if (root instanceof ShadowRoot) {
    const compact = compactProgressState(
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPilotLabel),
      currentStep,
      totalSteps,
    )
    const collapsedProgress = root.querySelector<HTMLElement>(
      '.collapsed-progress',
    )
    const collapsedLaunch =
      root.querySelector<HTMLButtonElement>('.collapsed-launch')
    if (collapsedProgress) collapsedProgress.textContent = compact.badge
    if (collapsedLaunch) {
      collapsedLaunch.setAttribute(
        'aria-label',
        `${translatedMessage(BROWSER_MESSAGE_KEYS.WidgetExpand)}: ${compact.accessibleLabel}`,
      )
    }
  }
}

export enum AuthenticatorOptionsResponseStatus {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

export type AuthenticatorOptionsResponse = {
  ok?: boolean
  status?:
    | AuthenticatorOptionsResponseStatus.Ready
    | AuthenticatorOptionsResponseStatus.Locked
    | AuthenticatorOptionsResponseStatus.Unavailable
  requestId?: string
  expiresAt?: number
}

export type AuthenticatorFillResponse = {
  ok?: boolean
  code?: string
}

export enum LoginPickerOpenResponseStatus {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
}

export type LoginPickerOpenResponse = {
  ok?: boolean
  status?:
    | LoginPickerOpenResponseStatus.Ready
    | LoginPickerOpenResponseStatus.Locked
    | LoginPickerOpenResponseStatus.Unavailable
  requestId?: string
  expiresAt?: number
}

export function translatedMessage(key: BrowserMessageKey): string {
  return chrome.i18n.getMessage(key) || 'Nook'
}

export function translatedMessageWithSubstitution(
  key: BrowserMessageKey,
  substitution: string,
): string {
  return chrome.i18n.getMessage(key, substitution) || 'Nook'
}

export async function loadPilotVaultConnection(): Promise<PilotVaultConnection> {
  const setup = await loadExtensionSetupState()
  return setup.kind === ExtensionSetupLoadKind.Ready
    ? { connected: true, vaultName: setup.setup.selectedVaultName }
    : { connected: false }
}

export function vaultConnectionLabel(connection: PilotVaultConnection): string {
  if (connection.connected && connection.vaultName) {
    return translatedMessageWithSubstitution(
      BROWSER_MESSAGE_KEYS.WidgetVaultConnected,
      connection.vaultName,
    )
  }
  return translatedMessage(BROWSER_MESSAGE_KEYS.WidgetVaultNotConnected)
}

export function removeWidget(): void {
  if (widgetState.host.kind === WidgetHostKind.Attached) {
    widgetState.host.element.remove()
  }
  widgetState.clearRenderedWidget()
  saveOfferState.clearActiveOffer()
  saveOfferState.confirmationActive = false
}
