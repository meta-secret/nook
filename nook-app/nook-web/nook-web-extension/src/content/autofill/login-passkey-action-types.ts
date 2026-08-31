import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import type { AuthenticationWorkflowApproval } from '../../lib/auth-workflow-messages'
import type { WebsiteLoginAccountOption } from '../../lib/login-fill-messages'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type PasskeyWidgetAction =
  | AuthenticationWorkflowAction.UsePasskey
  | AuthenticationWorkflowAction.CreatePasskey

type AuthenticationWorkflowControls = {
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}

export type FillAndSubmitAccountArgs = {
  account: Pick<WebsiteLoginAccountOption, 'vaultStoreId' | 'secretId'>
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}

export type OpenLoginPickerArgs = AuthenticationWorkflowControls

export type GeneratePasswordWithNookArgs = AuthenticationWorkflowControls

export type ProposePasskeyWithNookArgs = Pick<
  AuthenticationWorkflowControls,
  'description' | 'continueButton' | 'workflow' | 'approval'
> & {
  action: PasskeyWidgetAction
}

export type ContinueWithNookArgs = AuthenticationWorkflowControls
