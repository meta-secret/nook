import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'

import { CompactProgressState } from '../../lib/auth-widget-policy'

import type { WebsiteLoginFillResponse } from '../../lib/login-fill-messages'

import { AuthenticationWorkflowKind } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

import {
  extensionPairingStateLoader,
  ExtensionSetupLoadKind,
} from '../../lib/pairing-state'

import {
  PilotVaultConnectionKind,
  type PilotVaultConnection,
  WidgetVaultPresentationKind,
  type WidgetVaultPresentation,
} from './widget-presentation-state'

import { WidgetHostKind, saveOfferState, widgetState } from './state'

export type { PilotVaultConnection } from './widget-presentation-state'

export const WIDGET_HOST_ID = 'nook-auth-widget'

export const DRAG_THRESHOLD_PX = 4

export const OUTCOME_EVIDENCE_TIMEOUT_MS = 8_000

export const OUTCOME_EVIDENCE_POLL_MS = 250

export type { WebsiteLoginFillResponse as LoginFillResponse }

type WorkflowCopyProjection = {
  readonly titleKey: BrowserMessageKey
  readonly descriptionKey: BrowserMessageKey
}

const loginWorkflowCopy: WorkflowCopyProjection = {
  titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
  descriptionKey: BROWSER_MESSAGE_KEYS.WidgetLoginDescription,
}
const signupWorkflowCopy: WorkflowCopyProjection = {
  titleKey: BROWSER_MESSAGE_KEYS.WidgetSignupTitle,
  descriptionKey: BROWSER_MESSAGE_KEYS.WidgetSignupDescription,
}
const passwordChangeWorkflowCopy: WorkflowCopyProjection = {
  titleKey: BROWSER_MESSAGE_KEYS.WidgetPasswordChangeTitle,
  descriptionKey: BROWSER_MESSAGE_KEYS.WidgetPasswordChangeDescription,
}
const authenticatorWorkflowCopy: WorkflowCopyProjection = {
  titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
  descriptionKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorDescription,
}
const manualWorkflowCopy: WorkflowCopyProjection = {
  titleKey: BROWSER_MESSAGE_KEYS.WidgetManualTitle,
  descriptionKey: BROWSER_MESSAGE_KEYS.WidgetManualDescription,
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
        return new WorkflowCopy(loginWorkflowCopy)
      case AuthenticationWorkflowKind.Signup:
        return new WorkflowCopy(signupWorkflowCopy)
      case AuthenticationWorkflowKind.PasswordChange:
        return new WorkflowCopy(passwordChangeWorkflowCopy)
      case AuthenticationWorkflowKind.TotpChallenge:
        return new WorkflowCopy(authenticatorWorkflowCopy)
      case AuthenticationWorkflowKind.TotpEnrollment:
      case AuthenticationWorkflowKind.Manual:
        return new WorkflowCopy(manualWorkflowCopy)
    }
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
    const setup = await extensionPairingStateLoader.loadExtensionSetupState()
    return setup.kind === ExtensionSetupLoadKind.Ready
      ? {
          kind: PilotVaultConnectionKind.Connected,
          vaultName: setup.setup.selectedVaultName,
        }
      : { kind: PilotVaultConnectionKind.NotConnected }
  }

  vaultConnectionLabel(presentation: WidgetVaultPresentation): string {
    switch (presentation.kind) {
      case WidgetVaultPresentationKind.NotConnected:
        return this.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetVaultNotConnected,
        )
      case WidgetVaultPresentationKind.Locked:
        return this.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetVaultLocked)
      case WidgetVaultPresentationKind.NoMatchingCredential:
        return this.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetNoMatch)
      case WidgetVaultPresentationKind.Unavailable:
        return this.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault)
      case WidgetVaultPresentationKind.Connected:
      case WidgetVaultPresentationKind.CredentialAvailable: {
        const nookTypedArgs0_1: Parameters<
          typeof this.translatedMessageWithSubstitution
        >[0] = {
          key: BROWSER_MESSAGE_KEYS.WidgetVaultConnected,
          substitution: presentation.vaultName,
        }
        return this.translatedMessageWithSubstitution(nookTypedArgs0_1)
      }
    }
  }

  removeWidget(): void {
    if (this.ui.widgetState.host.kind === WidgetHostKind.Attached) {
      this.ui.widgetState.host.detach()
    }
    this.ui.widgetState.clearRenderedWidget()
    this.ui.saveOfferState.clearActiveOffer()
    this.ui.saveOfferState.confirmationActive = false
  }
}

const workflowUiDependencies: ConstructorParameters<typeof WorkflowUi>[0] = {
  widgetState,
  saveOfferState,
}
export const workflowUi = new WorkflowUi(workflowUiDependencies)
