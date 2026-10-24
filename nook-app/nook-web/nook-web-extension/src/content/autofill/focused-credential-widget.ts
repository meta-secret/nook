import { AuthenticationGesture } from '../../lib/auth-widget-policy'
import { AuthenticationWorkflowKind } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
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
import {
  VaultConnectResumeKind,
  WidgetVaultGateSurface,
  type WidgetVaultGateMount,
} from './widget-vault-gate'
import { WorkflowCopy, workflowUi } from './workflow-ui'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'

type FocusedCredentialWidgetMount = {
  readonly vaultConnection: PilotVaultConnection
  /** The focused field the widget is offered for. */
  readonly field: HTMLInputElement
  readonly choose: () => void
}

/** Uses the existing widget shell for an explicit, single-field credential choice. */
export class FocusedCredentialWidget {
  private constructor(
    readonly shell: ReturnType<
      typeof authenticationWidgetShell.createWidgetShell
    >,
  ) {}

  static mount(request: FocusedCredentialWidgetMount): FocusedCredentialWidget {
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
    shell.host.setAttribute('data-nook-credential-mode', 'focused')
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
        return FocusedCredentialWidget.mounted(shell)
      }
      case WidgetVaultGateKind.Open:
        break
    }
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
    return FocusedCredentialWidget.mounted(shell)
  }

  private static mounted(
    shell: FocusedCredentialWidget['shell'],
  ): FocusedCredentialWidget {
    const mountRequest: Parameters<
      typeof authenticationWidgetShell.mountWidgetShell
    >[0] = {
      shell,
      workflowKey: 'focused-credential',
      workflowRoot: { kind: WidgetWorkflowRootKind.Unassigned },
    }
    authenticationWidgetShell.mountWidgetShell(mountRequest)
    return new FocusedCredentialWidget(shell)
  }
}
