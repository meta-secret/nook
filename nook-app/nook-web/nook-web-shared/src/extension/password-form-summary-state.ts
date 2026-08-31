import type { PasswordFieldQuery } from './password-form-fields'
import {
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from './password-form-submission-controls'
import type { PasswordFormSummary } from './password-forms'

export function passwordFieldQuery(
  request: PasswordFormScopeQuery,
): PasswordFieldQuery {
  if (request.kind === PasswordFormQueryKind.Root) return { root: request.root }
  return { root: request.root, formScope: request.formScope }
}

export const emptyPasswordFormSummary: PasswordFormSummary = {
  passwordFieldCount: 0,
  currentPasswordFieldCount: 0,
  newPasswordFieldCount: 0,
  genericPasswordFieldCount: 0,
  usernameFieldCount: 0,
  oneTimeCodeFieldCount: 0,
  manualCheckpointPresent: false,
  passkeyControlPresent: false,
  formCount: 0,
  observedAt: 0,
}
