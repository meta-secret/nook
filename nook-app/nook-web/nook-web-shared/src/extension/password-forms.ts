export type PasswordFormSummary = {
  passwordFieldCount: number
  usernameFieldCount: number
  formCount: number
  observedAt: number
}

export const usernameFieldSelectors = [
  'input[type="email"]',
  'input[type="text"][autocomplete~="username" i]',
  'input[type="text"][name*="user" i]',
  'input[type="text"][name*="email" i]',
  'input[type="text"][id*="user" i]',
  'input[type="text"][id*="email" i]',
] as const

export function summarizePasswordForms(
  root: ParentNode = document,
): PasswordFormSummary {
  const passwordFields = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  )
  const usernameFields = Array.from(
    root.querySelectorAll<HTMLInputElement>(usernameFieldSelectors.join(',')),
  )
  const forms = new Set<HTMLFormElement>()

  for (const field of [...passwordFields, ...usernameFields]) {
    if (field.form) {
      forms.add(field.form)
    }
  }

  return {
    passwordFieldCount: passwordFields.length,
    usernameFieldCount: usernameFields.length,
    formCount: forms.size,
    observedAt: Date.now(),
  }
}
