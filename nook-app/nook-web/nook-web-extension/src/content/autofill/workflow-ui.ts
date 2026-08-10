import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'
import { compactProgressState } from '../../lib/auth-widget-policy'
import type { WebsiteLoginFillResponse } from '../../lib/login-fill-messages'
import { AuthenticationWorkflowKind } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
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

export type { WebsiteLoginFillResponse as LoginFillResponse }

export type WorkflowCopy = {
  titleKey: BrowserMessageKey
  descriptionKey: BrowserMessageKey
}

export function workflowCopy(kind: AuthenticationWorkflowKind): WorkflowCopy {
  switch (kind) {
    case AuthenticationWorkflowKind.Login:
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetLoginDescription,
      }
    case AuthenticationWorkflowKind.Signup:
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetSignupTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetSignupDescription,
      }
    case AuthenticationWorkflowKind.PasswordChange:
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetPasswordChangeTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetPasswordChangeDescription,
      }
    case AuthenticationWorkflowKind.TotpChallenge:
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorDescription,
      }
    case AuthenticationWorkflowKind.TotpEnrollment:
    case AuthenticationWorkflowKind.Manual:
      return {
        titleKey: BROWSER_MESSAGE_KEYS.WidgetManualTitle,
        descriptionKey: BROWSER_MESSAGE_KEYS.WidgetManualDescription,
      }
  }
}

export function progressLabel({
  currentStep,
  totalSteps,
}: {
  currentStep: number
  totalSteps: number
}): string {
  return `${translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPilotLabel)} · ${currentStep}/${totalSteps}`
}

export function setFlightProgress({
  step,
  title,
  currentStep,
  totalSteps,
  titleKey,
}: {
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  currentStep: number
  totalSteps: number
  titleKey: BrowserMessageKey
}): void {
  const nookTypedArgs0_0: Parameters<typeof progressLabel>[0] = {
    currentStep,
    totalSteps,
  }
  step.textContent = progressLabel(nookTypedArgs0_0)
  title.textContent = translatedMessage(titleKey)
  const root = step.getRootNode()
  if (root instanceof ShadowRoot) {
    const compactProgressArgs: Parameters<typeof compactProgressState>[0] = {
      pilotLabel: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPilotLabel),
      currentStep,
      totalSteps,
    }
    const compact = compactProgressState(compactProgressArgs)
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

export type AuthenticatorOptionsResponse =
  | { ok: false }
  | {
      ok: true
      status: AuthenticatorOptionsResponseStatus.Ready
      requestId: string
      expiresAt: number
    }
  | { ok: true; status: AuthenticatorOptionsResponseStatus.Locked }
  | { ok: true; status: AuthenticatorOptionsResponseStatus.Unavailable }

export function isAuthenticatorOptionsResponse(
  response: object,
): response is AuthenticatorOptionsResponse {
  if (!('ok' in response) || typeof response.ok !== 'boolean') return false
  if (response.ok === false) return !('status' in response)
  if (!('status' in response)) return false
  if (response.status === AuthenticatorOptionsResponseStatus.Ready) {
    return (
      'requestId' in response &&
      typeof response.requestId === 'string' &&
      response.requestId.length > 0 &&
      'expiresAt' in response &&
      typeof response.expiresAt === 'number' &&
      Number.isFinite(response.expiresAt)
    )
  }
  return (
    (response.status === AuthenticatorOptionsResponseStatus.Locked ||
      response.status === AuthenticatorOptionsResponseStatus.Unavailable) &&
    !('requestId' in response) &&
    !('expiresAt' in response)
  )
}

export function translatedMessage(key: BrowserMessageKey): string {
  return chrome.i18n.getMessage(key) || 'Nook'
}

export function translatedMessageWithSubstitution({
  key,
  substitution,
}: {
  key: BrowserMessageKey
  substitution: string
}): string {
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
    const nookTypedArgs0_1: Parameters<
      typeof translatedMessageWithSubstitution
    >[0] = {
      key: BROWSER_MESSAGE_KEYS.WidgetVaultConnected,
      substitution: connection.vaultName,
    }
    return translatedMessageWithSubstitution(nookTypedArgs0_1)
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
