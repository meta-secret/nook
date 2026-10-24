import { AuthenticationGesture } from '../../lib/auth-widget-policy'
import {
  AuthenticationWorkflowKind,
  PersonalFieldGroup,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { authenticationWidgetShell } from './widget-shell'
import { WidgetWorkflowRootKind } from './state'
import {
  SavedLoginPresentationKind,
  WidgetVaultGate,
  WidgetVaultGateKind,
  WidgetVaultPresentationProjection,
  WidgetVaultRequirement,
  type PilotVaultConnection,
} from './widget-presentation-state'
import { WorkflowCopy, workflowUi } from './workflow-ui'
import {
  VaultConnectResumeKind,
  WidgetVaultGateSurface,
  type WidgetVaultGateMount,
} from './widget-vault-gate'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'

type PersonalFillWidgetMount = {
  readonly vaultConnection: PilotVaultConnection
  readonly group: keyof typeof PersonalFieldGroup
  /** The focused field the widget is offered for. */
  readonly field: HTMLInputElement
  readonly choose: () => void
}

type PersonalFillWidgetShell = ReturnType<
  typeof authenticationWidgetShell.createWidgetShell
>

/** Uses the existing Pilot shell for one explicit personal-data record choice. */
export class PersonalFillWidget {
  private constructor(readonly shell: PersonalFillWidgetShell) {}

  private static titleKey(
    group: keyof typeof PersonalFieldGroup,
  ): BrowserMessageKey {
    switch (PersonalFieldGroup[group]) {
      case PersonalFieldGroup.Person:
        return BROWSER_MESSAGE_KEYS.WidgetPersonalPersonTitle
      case PersonalFieldGroup.Address:
        return BROWSER_MESSAGE_KEYS.WidgetPersonalAddressTitle
      case PersonalFieldGroup.Card:
        return BROWSER_MESSAGE_KEYS.WidgetPersonalCardTitle
    }
  }

  static mount(request: PersonalFillWidgetMount): PersonalFillWidget {
    const vaultPresentation = WidgetVaultPresentationProjection.forConnection(
      request.vaultConnection,
    )
    const shellRequest: Parameters<
      typeof authenticationWidgetShell.createWidgetShell
    >[0] = {
      copy: WorkflowCopy.forKind(AuthenticationWorkflowKind.Login),
      vaultPresentation,
      savedLoginAction: true,
      savedLoginPresentation: SavedLoginPresentationKind.Workflow,
      currentStep: 1,
      totalSteps: 1,
    }
    const shell = authenticationWidgetShell.createWidgetShell(shellRequest)
    shell.host.setAttribute('data-nook-credential-mode', 'personal')
    const gateRequest: Parameters<typeof WidgetVaultGate.decide>[0] = {
      presentation: vaultPresentation,
      requirement: WidgetVaultRequirement.Required,
    }
    const gate = WidgetVaultGate.decide(gateRequest)
    switch (gate) {
      case WidgetVaultGateKind.Connect:
      case WidgetVaultGateKind.Unlock: {
        const gateMount: WidgetVaultGateMount = {
          shell,
          gate,
          resume: { kind: VaultConnectResumeKind.Field, input: request.field },
        }
        WidgetVaultGateSurface.render(gateMount)
        return PersonalFillWidget.mounted(shell)
      }
      case WidgetVaultGateKind.Open:
        break
    }
    shell.title.textContent = workflowUi.translatedMessage(
      PersonalFillWidget.titleKey(request.group),
    )
    shell.description.textContent = workflowUi.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetPersonalDescription,
    )
    const continueLabel = workflowUi.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetContinue,
    )
    shell.continueButton.textContent = continueLabel
    shell.continueButton.setAttribute('aria-label', continueLabel)
    shell.continueButton.addEventListener('click', (event) => {
      switch (new AuthenticationGesture(event).trusted) {
        case false:
          return
        case true:
          request.choose()
      }
    })
    return PersonalFillWidget.mounted(shell)
  }

  private static mounted(shell: PersonalFillWidgetShell): PersonalFillWidget {
    const mountRequest: Parameters<
      typeof authenticationWidgetShell.mountWidgetShell
    >[0] = {
      shell,
      workflowKey: 'personal-fill',
      workflowRoot: { kind: WidgetWorkflowRootKind.Unassigned },
    }
    authenticationWidgetShell.mountWidgetShell(mountRequest)
    return new PersonalFillWidget(shell)
  }
}
