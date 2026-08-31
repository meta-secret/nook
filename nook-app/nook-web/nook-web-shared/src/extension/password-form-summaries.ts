import {
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
  hasAutocompleteToken,
  pageHasManualCheckpoint,
  pageHasPasskeyControl,
  PasswordFormScopeKind,
  type PasswordFieldQuery,
  type PasswordFormScope,
} from './password-form-fields'
import {
  PasswordFormQueryKind,
  type PasswordFormScopeQuery,
} from './password-form-submission-controls'

export type PasswordFormSummary = {
  passwordFieldCount: number
  currentPasswordFieldCount: number
  newPasswordFieldCount: number
  genericPasswordFieldCount: number
  usernameFieldCount: number
  oneTimeCodeFieldCount: number
  manualCheckpointPresent: boolean
  passkeyControlPresent: boolean
  formCount: number
  observedAt: number
}

export type PasswordFormObservation = {
  root: ParentNode
  formScope: PasswordFormScope
  summary: PasswordFormSummary
}

type PasswordFormSummaryRequest = PasswordFormScopeQuery

export function passwordFieldQuery(
  request: PasswordFormScopeQuery,
): PasswordFieldQuery {
  if (request.kind === PasswordFormQueryKind.Root) return { root: request.root }
  return { root: request.root, formScope: request.formScope }
}

export function summarizeRoot(
  request: PasswordFormSummaryRequest,
): PasswordFormSummary {
  const { root } = request
  const passwordFields = findPasswordFields(passwordFieldQuery(request))
  const usernameFields = findUsernameFields(passwordFieldQuery(request))
  const oneTimeCodeFields = findOneTimeCodeFields(passwordFieldQuery(request))
  const currentPasswordFieldCount = passwordFields.filter((field) => {
    const tokenRequest: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: 'current-password',
    }
    return hasAutocompleteToken(tokenRequest)
  }).length
  const newPasswordFieldCount = passwordFields.filter((field) => {
    const tokenRequest: Parameters<typeof hasAutocompleteToken>[0] = {
      field,
      expected: 'new-password',
    }
    return hasAutocompleteToken(tokenRequest)
  }).length
  const forms = new Set<HTMLFormElement>()
  for (const field of [
    ...passwordFields,
    ...usernameFields,
    ...oneTimeCodeFields,
  ]) {
    if (field.form) forms.add(field.form)
  }
  return {
    passwordFieldCount: passwordFields.length,
    currentPasswordFieldCount,
    newPasswordFieldCount,
    genericPasswordFieldCount:
      passwordFields.length - currentPasswordFieldCount - newPasswordFieldCount,
    usernameFieldCount: usernameFields.length,
    oneTimeCodeFieldCount: oneTimeCodeFields.length,
    manualCheckpointPresent: pageHasManualCheckpoint(root),
    passkeyControlPresent: pageHasPasskeyControl(root),
    formCount: forms.size,
    observedAt: Date.now(),
  }
}

export function summarizePasswordForms(): PasswordFormSummary {
  const request: PasswordFormSummaryRequest = {
    kind: PasswordFormQueryKind.Root,
    root: document,
  }
  return summarizeRoot(request)
}

export function documentAuthenticationWorkflowObservation(): PasswordFormObservation {
  const root = document
  const request: PasswordFormSummaryRequest = {
    kind: PasswordFormQueryKind.Root,
    root,
  }
  return {
    root,
    formScope: { kind: PasswordFormScopeKind.Unowned },
    summary: summarizeRoot(request),
  }
}
