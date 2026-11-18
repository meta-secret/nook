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

export enum FocusedFieldKind {
  Credential = 'focused',
  Personal = 'personal',
}

type FocusedFieldChoice =
  | { readonly kind: FocusedFieldKind.Credential }
  | {
      readonly kind: FocusedFieldKind.Personal
      readonly group: keyof typeof PersonalFieldGroup
    }

export type FocusedFieldWidgetMount<
  Kind extends FocusedFieldKind = FocusedFieldKind,
> = Extract<FocusedFieldChoice, { readonly kind: Kind }> & {
  readonly vaultConnection: PilotVaultConnection
  /** The focused field the widget is offered for. */
  readonly field: HTMLInputElement
  readonly choose: () => void
}

type FocusedFieldWidgetShell = ReturnType<
  typeof authenticationWidgetShell.createWidgetShell
>

type FocusedFieldChooser = {
  readonly shell: FocusedFieldWidgetShell
  readonly request: FocusedFieldWidgetMount
}

/** The Pilot chooser for one focused credential or personal-data field. */
export class FocusedFieldWidget {
  private constructor(readonly shell: FocusedFieldWidgetShell) {}

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

  static mount(request: FocusedFieldWidgetMount): FocusedFieldWidget {
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
    shell.host.setAttribute('data-nook-credential-mode', request.kind)
    const gateRequest: Parameters<typeof WidgetVaultGate.decide>[0] = {
      presentation: vaultPresentation,
      requirement: WidgetVaultRequirement.Required,
    }
    const gate = WidgetVaultGate.decide(gateRequest)
    switch (gate) {
      case WidgetVaultGateKind.Connect:
      case WidgetVaultGateKind.CreateVault:
      case WidgetVaultGateKind.Unlock: {
        const gateMount: WidgetVaultGateMount = {
          shell,
          gate,
          resume: { kind: VaultConnectResumeKind.Field, input: request.field },
        }
        WidgetVaultGateSurface.render(gateMount)
        break
      }
      case WidgetVaultGateKind.Open: {
        const chooser: FocusedFieldChooser = { shell, request }
        FocusedFieldWidget.showChooser(chooser)
        break
      }
    }
    const mountRequest: Parameters<
      typeof authenticationWidgetShell.mountWidgetShell
    >[0] = {
      shell,
      workflowKey: FocusedFieldWidget.workflowKey(request.kind),
      workflowRoot: { kind: WidgetWorkflowRootKind.Unassigned },
    }
    authenticationWidgetShell.mountWidgetShell(mountRequest)
    return new FocusedFieldWidget(shell)
  }

  private static workflowKey(kind: FocusedFieldKind): string {
    switch (kind) {
      case FocusedFieldKind.Credential:
        return 'focused-credential'
      case FocusedFieldKind.Personal:
        return 'personal-fill'
    }
  }

  private static showChooser({ shell, request }: FocusedFieldChooser): void {
    switch (request.kind) {
      case FocusedFieldKind.Credential:
        break
      case FocusedFieldKind.Personal:
        shell.title.textContent = workflowUi.translatedMessage(
          FocusedFieldWidget.titleKey(request.group),
        )
        shell.description.textContent = workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetPersonalDescription,
        )
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
  }
}
