import { PasswordFormScopeKind } from './password-form-fields'
import {
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from './password-form-submission-controls'
import {
  summarizeRoot,
  type PasswordFormObservation,
} from './password-forms'

export function documentAuthenticationWorkflowObservation(): PasswordFormObservation {
  const root = document
  const request: PasswordFormScopeQuery = {
    kind: PasswordFormQueryKind.Root,
    root,
  }
  return {
    root,
    formScope: { kind: PasswordFormScopeKind.Unowned },
    summary: summarizeRoot(request),
  }
}
