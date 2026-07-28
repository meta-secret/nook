import { compactProgressState } from '../../lib/auth-widget-policy'
import type { AuthenticationWorkflowSnapshotView } from '../../lib/auth-workflow-messages'
import type { WebsiteLoginAccountOption } from '../../lib/login-fill-messages'
import { loadExtensionSetupState } from '../../lib/pairing-state'
import { saveOfferState, widgetState } from './state'

export type PilotVaultConnection = {
  connected: boolean
  vaultName?: string
}

export const WIDGET_HOST_ID = 'nook-auth-widget'

export const DRAG_THRESHOLD_PX = 4

export const MAX_WORKFLOW_OBSERVATIONS = 20

export const OUTCOME_EVIDENCE_TIMEOUT_MS = 8_000

export const OUTCOME_EVIDENCE_POLL_MS = 250

export type LoginOptionsResponse = {
  ok?: boolean
  status?: 'ready' | 'locked' | 'unavailable'
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
  titleKey: string
  descriptionKey: string
}

export function workflowCopy(kind: string): WorkflowCopy {
  switch (kind) {
    case 'login':
      return {
        titleKey: 'widgetLoginTitle',
        descriptionKey: 'widgetLoginDescription',
      }
    case 'signup':
      return {
        titleKey: 'widgetSignupTitle',
        descriptionKey: 'widgetSignupDescription',
      }
    case 'password-change':
      return {
        titleKey: 'widgetPasswordChangeTitle',
        descriptionKey: 'widgetPasswordChangeDescription',
      }
    case 'totp-challenge':
      return {
        titleKey: 'widgetAuthenticatorTitle',
        descriptionKey: 'widgetAuthenticatorDescription',
      }
    default:
      return {
        titleKey: 'widgetManualTitle',
        descriptionKey: 'widgetManualDescription',
      }
  }
}

export function progressLabel(currentStep: number, totalSteps: number): string {
  return `${translatedMessage('widgetPilotLabel')} · ${currentStep}/${totalSteps}`
}

export function setFlightProgress(
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  currentStep: number,
  totalSteps: number,
  titleKey: string,
): void {
  step.textContent = progressLabel(currentStep, totalSteps)
  title.textContent = translatedMessage(titleKey)
  const root = step.getRootNode()
  if (root instanceof ShadowRoot) {
    const compact = compactProgressState(
      translatedMessage('widgetPilotLabel'),
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
        `${translatedMessage('widgetExpand')}: ${compact.accessibleLabel}`,
      )
    }
  }
}

export type AuthenticatorOptionsResponse = {
  ok?: boolean
  status?: 'ready' | 'locked' | 'unavailable'
  requestId?: string
  expiresAt?: number
}

export type AuthenticatorFillResponse = {
  ok?: boolean
  code?: string
}

export type LoginPickerOpenResponse = {
  ok?: boolean
  status?: 'ready' | 'locked' | 'unavailable'
  requestId?: string
  expiresAt?: number
}

export function translatedMessage(key: string): string {
  return chrome.i18n.getMessage(key) || 'Nook'
}

export function translatedMessageWithSubstitution(
  key: string,
  substitution: string,
): string {
  return chrome.i18n.getMessage(key, substitution) || 'Nook'
}

export async function loadPilotVaultConnection(): Promise<PilotVaultConnection> {
  const setup = await loadExtensionSetupState()
  return setup
    ? { connected: true, vaultName: setup.selectedVaultName }
    : { connected: false }
}

export function vaultConnectionLabel(connection: PilotVaultConnection): string {
  if (connection.connected && connection.vaultName) {
    return translatedMessageWithSubstitution(
      'widgetVaultConnected',
      connection.vaultName,
    )
  }
  return translatedMessage('widgetVaultNotConnected')
}

export function removeWidget(): void {
  widgetState.host?.remove()
  widgetState.host = undefined
  widgetState.renderedWorkflowKey = undefined
  widgetState.renderedWorkflowRoot = undefined
  saveOfferState.activeOffer = undefined
  saveOfferState.confirmationActive = false
}
