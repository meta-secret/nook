import {
  WebsiteLoginOptionsKind,
  type SignInAttemptLoginReference,
  type WebsiteLoginAccountOption,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import { WebsiteLoginOptionsMessageType } from '../../lib/login-fill-messages'
import { authenticationWorkflowUi } from './authentication-workflow-ui-state'
import { loginCredentialFillAction } from './login-credential-fill-action'
import type { LoginChecklistAttemptActions } from './login-checklist-progress'
import { loginPasskeyInteraction } from './login-passkey-actions'
import type { OpenLoginPickerArgs } from './login-passkey-action-types'
import {
  RuntimeMessageDeliveryKind,
  authenticationRuntimeTransport,
} from './runtime-message-adapter'
import { SignInAttemptLogin } from './sign-in-attempt-login'
import {
  SignInAttemptHostActionKind,
  type SignInAttemptHostAction,
} from './sign-in-attempt-session'
import { scanState, widgetState } from './state'
import { workflowUi } from './workflow-ui'

type SignInAttemptLoginControls = OpenLoginPickerArgs
type SignInAttemptLoginOptions = Extract<
  Awaited<
    ReturnType<
      typeof authenticationRuntimeTransport.sendLoginOptionsRuntimeMessage
    >
  >,
  { readonly kind: RuntimeMessageDeliveryKind.Delivered }
>['response']
type SignInAttemptReadyLogins = {
  readonly authorizationGeneration: string
  readonly accounts: readonly WebsiteLoginAccountOption[]
  readonly login: SignInAttemptLoginReference
}
type SignInAttemptLoginSelection = {
  readonly options: SignInAttemptLoginOptions
  readonly login: SignInAttemptLoginReference
}

/**
 * Runs a Rust-selected follow-up with the login Pilot's live controls, always
 * through the existing fill or picker path and its revalidation.
 */
export class SignInAttemptLoginActions implements LoginChecklistAttemptActions {
  constructor(private readonly controls: SignInAttemptLoginControls) {}

  run(action: SignInAttemptHostAction): void {
    switch (action.kind) {
      case SignInAttemptHostActionKind.RestartWithSameLogin:
        void this.restart(action.login)
        return
      case SignInAttemptHostActionKind.OpenLoginPicker:
        void loginPasskeyInteraction.openLoginPicker(this.controls)
        return
      case SignInAttemptHostActionKind.OpenAuthenticatorPicker:
        scanState.schedule()
        return
    }
  }

  /** Try again: fresh login options, the same opaque login, a new attempt. */
  private async restart(login: SignInAttemptLoginReference): Promise<void> {
    widgetState.busy = true
    this.controls.continueButton.disabled = true
    try {
      const message: Parameters<
        typeof authenticationRuntimeTransport.sendLoginOptionsRuntimeMessage
      >[0] = {
        type: WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions,
        payload: { origin: location.origin },
      }
      const delivery =
        await authenticationRuntimeTransport.sendLoginOptionsRuntimeMessage(
          message,
        )
      switch (delivery.kind) {
        case RuntimeMessageDeliveryKind.Unavailable:
          this.status(BROWSER_MESSAGE_KEYS.WidgetFillFailed)
          return
        case RuntimeMessageDeliveryKind.Delivered:
          break
      }
      const selection: SignInAttemptLoginSelection = {
        options: delivery.response,
        login,
      }
      await this.fillSelected(selection)
    } finally {
      widgetState.busy = false
      this.controls.continueButton.disabled = false
    }
  }

  private async fillSelected(selection: SignInAttemptLoginSelection) {
    const options = selection.options
    switch (options.kind) {
      case WebsiteLoginOptionsKind.Locked:
        this.status(BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue)
        return
      case WebsiteLoginOptionsKind.Unavailable:
        this.status(BROWSER_MESSAGE_KEYS.WidgetConnectVault)
        return
      case WebsiteLoginOptionsKind.Rejected:
        this.status(BROWSER_MESSAGE_KEYS.WidgetFillFailed)
        return
      case WebsiteLoginOptionsKind.Ready:
        break
    }
    switch (true) {
      case 'accounts' in options: {
        const ready: SignInAttemptReadyLogins = {
          authorizationGeneration: options.authorizationGeneration,
          accounts: options.accounts,
          login: selection.login,
        }
        return this.fillMatching(ready)
      }
      case true:
        break
    }
    this.status(BROWSER_MESSAGE_KEYS.WidgetFillFailed)
  }

  /** Only the attempt's own login is filled again; another login needs the picker. */
  private async fillMatching(ready: SignInAttemptReadyLogins) {
    const account = ready.accounts.find((candidate) => {
      const match: Parameters<typeof SignInAttemptLogin.matches>[0] = {
        login: ready.login,
        account: candidate,
      }
      return SignInAttemptLogin.matches(match)
    })
    switch (true) {
      case account instanceof Object: {
        const request: Parameters<
          typeof loginCredentialFillAction.fillAndSubmitAccount
        >[0] = {
          ...this.controls,
          account: {
            vaultStoreId: account.vaultStoreId,
            secretId: account.secretId,
            authorizationGeneration: ready.authorizationGeneration,
          },
        }
        await loginCredentialFillAction.fillAndSubmitAccount(request)
        return
      }
      case true:
        break
    }
    this.status(BROWSER_MESSAGE_KEYS.WidgetNoMatch)
  }

  private status(
    key: Parameters<typeof workflowUi.translatedMessage>[0],
  ): void {
    const status: Parameters<typeof authenticationWorkflowUi.setStatus>[0] = {
      description: this.controls.description,
      continueButton: this.controls.continueButton,
      text: workflowUi.translatedMessage(key),
      enableContinue: true,
    }
    authenticationWorkflowUi.setStatus(status)
  }
}
