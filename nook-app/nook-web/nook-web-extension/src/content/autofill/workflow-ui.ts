import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'

import { CompactProgressState } from '../../lib/auth-widget-policy'

import type { WebsiteLoginFillResponse } from '../../lib/login-fill-messages'

import { AuthenticationWorkflowKind } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

import {
  ExtensionSetupLoadKind,
  ExtensionPairingStateQueryMessage as ExtensionPairingStateQueryMessageSchema,
} from '../../lib/pairing-state'

import { WidgetHostKind, saveOfferState, widgetState } from './state'

export type PilotVaultConnection = {
  connected: boolean
  vaultName?: string
}

export const WIDGET_HOST_ID = 'nook-auth-widget'

export const DRAG_THRESHOLD_PX = 4

export const OUTCOME_EVIDENCE_TIMEOUT_MS = 8_000

export const OUTCOME_EVIDENCE_POLL_MS = 250

export type { WebsiteLoginFillResponse as LoginFillResponse }

type WorkflowCopyProjection = {
  readonly titleKey: BrowserMessageKey
  readonly descriptionKey: BrowserMessageKey
}

export class WorkflowCopy {
  readonly titleKey: BrowserMessageKey
  readonly descriptionKey: BrowserMessageKey
  private constructor(value: WorkflowCopyProjection) {
    this.titleKey = value.titleKey
    this.descriptionKey = value.descriptionKey
  }
  static forKind(kind: AuthenticationWorkflowKind): WorkflowCopy {
    switch (kind) {
      case AuthenticationWorkflowKind.Login:
        return new WorkflowCopy({
          titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
          descriptionKey: BROWSER_MESSAGE_KEYS.WidgetLoginDescription,
        })
      case AuthenticationWorkflowKind.Signup:
        return new WorkflowCopy({
          titleKey: BROWSER_MESSAGE_KEYS.WidgetSignupTitle,
          descriptionKey: BROWSER_MESSAGE_KEYS.WidgetSignupDescription,
        })
      case AuthenticationWorkflowKind.PasswordChange:
        return new WorkflowCopy({
          titleKey: BROWSER_MESSAGE_KEYS.WidgetPasswordChangeTitle,
          descriptionKey: BROWSER_MESSAGE_KEYS.WidgetPasswordChangeDescription,
        })
      case AuthenticationWorkflowKind.TotpChallenge:
        return new WorkflowCopy({
          titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
          descriptionKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorDescription,
        })
      case AuthenticationWorkflowKind.TotpEnrollment:
      case AuthenticationWorkflowKind.Manual:
        return new WorkflowCopy({
          titleKey: BROWSER_MESSAGE_KEYS.WidgetManualTitle,
          descriptionKey: BROWSER_MESSAGE_KEYS.WidgetManualDescription,
        })
    }
  }
  static titleForObservation(
    workflow: PasswordFormObservation,
  ): BrowserMessageKey {
    if (
      workflow.summary.currentPasswordFieldCount > 0 &&
      workflow.summary.newPasswordFieldCount > 0
    ) {
      return BROWSER_MESSAGE_KEYS.WidgetPasswordChangeTitle
    }
    if (workflow.summary.newPasswordFieldCount > 0) {
      return BROWSER_MESSAGE_KEYS.WidgetSignupTitle
    }
    return BROWSER_MESSAGE_KEYS.WidgetLoginTitle
  }
}

type ProgressLabelArgs = {
  currentStep: number
  totalSteps: number
}

type SetFlightProgressArgs = {
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  currentStep: number
  totalSteps: number
  titleKey: BrowserMessageKey
}

type TranslatedMessageWithSubstitutionArgs = {
  key: BrowserMessageKey
  substitution: string
}

/** Owns the browser runtime resources shared by these interactions. */
type WorkflowUiContext = {
  readonly widgetState: typeof widgetState
  readonly saveOfferState: typeof saveOfferState
}
class WorkflowUi {
  constructor(private readonly ui: WorkflowUiContext) {}

  progressLabel({ currentStep, totalSteps }: ProgressLabelArgs): string {
    return `${this.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPilotLabel)} · ${currentStep}/${totalSteps}`
  }

  setFlightProgress({
    step,
    title,
    currentStep,
    totalSteps,
    titleKey,
  }: SetFlightProgressArgs): void {
    const nookTypedArgs0_0: Parameters<typeof this.progressLabel>[0] = {
      currentStep,
      totalSteps,
    }
    step.textContent = this.progressLabel(nookTypedArgs0_0)
    title.textContent = this.translatedMessage(titleKey)
    const root = step.getRootNode()
    if (root instanceof ShadowRoot) {
      const compactProgressArgs: ConstructorParameters<
        typeof CompactProgressState
      >[0] = {
        pilotLabel: this.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetPilotLabel,
        ),
        currentStep,
        totalSteps,
      }
      const compact = new CompactProgressState(compactProgressArgs)
      const collapsedProgress = root.querySelector<HTMLElement>(
        '.collapsed-progress',
      )
      const collapsedLaunch =
        root.querySelector<HTMLButtonElement>('.collapsed-launch')
      if (collapsedProgress) collapsedProgress.textContent = compact.badge
      if (collapsedLaunch) {
        collapsedLaunch.setAttribute(
          'aria-label',
          `${this.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetExpand)}: ${compact.accessibleLabel}`,
        )
      }
    }
  }

  translatedMessage(key: BrowserMessageKey): string {
    return chrome.i18n.getMessage(key) || 'Nook'
  }

  translatedMessageWithSubstitution({
    key,
    substitution,
  }: TranslatedMessageWithSubstitutionArgs): string {
    return chrome.i18n.getMessage(key, substitution) || 'Nook'
  }

  async loadPilotVaultConnection(): Promise<PilotVaultConnection> {
    const setup =
      await ExtensionPairingStateQueryMessageSchema.loadExtensionSetupState()
    return setup.kind === ExtensionSetupLoadKind.Ready
      ? { connected: true, vaultName: setup.setup.selectedVaultName }
      : { connected: false }
  }

  vaultConnectionLabel(connection: PilotVaultConnection): string {
    if (connection.connected && connection.vaultName) {
      const nookTypedArgs0_1: Parameters<
        typeof this.translatedMessageWithSubstitution
      >[0] = {
        key: BROWSER_MESSAGE_KEYS.WidgetVaultConnected,
        substitution: connection.vaultName,
      }
      return this.translatedMessageWithSubstitution(nookTypedArgs0_1)
    }
    return this.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetVaultNotConnected)
  }

  removeWidget(): void {
    if (this.ui.widgetState.host.kind === WidgetHostKind.Attached) {
      this.ui.widgetState.host.element.remove()
    }
    this.ui.widgetState.clearRenderedWidget()
    this.ui.saveOfferState.clearActiveOffer()
    this.ui.saveOfferState.confirmationActive = false
  }
}

export const workflowUi = new WorkflowUi({ widgetState, saveOfferState })
