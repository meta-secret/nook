import { AuthenticationGesture } from '../../lib/auth-widget-policy'
import { AuthenticationWorkflowKind } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { authenticationWidgetShell } from './widget-shell'
import { WidgetWorkflowRootKind } from './state'
import {
  WidgetVaultPresentationProjection,
  type PilotVaultConnection,
} from './widget-presentation-state'
import { WorkflowCopy } from './workflow-ui'

type FocusedCredentialWidgetMount = {
  readonly vaultConnection: PilotVaultConnection
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
    const shellRequest: Parameters<
      typeof authenticationWidgetShell.createWidgetShell
    >[0] = {
      copy: WorkflowCopy.forKind(AuthenticationWorkflowKind.Login),
      vaultPresentation: WidgetVaultPresentationProjection.forConnection(
        request.vaultConnection,
      ),
      savedLoginAction: true,
      currentStep: 1,
      totalSteps: 1,
    }
    const shell = authenticationWidgetShell.createWidgetShell(shellRequest)
    shell.host.setAttribute('data-nook-credential-mode', 'focused')
    shell.continueButton.addEventListener('click', (event) => {
      switch (new AuthenticationGesture(event).trusted) {
        case false:
          return
        case true:
          request.choose()
      }
    })
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
