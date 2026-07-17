export type PasswordFormSummary = {
  passwordFieldCount: number
  usernameFieldCount: number
  formCount: number
  observedAt: number
}

export type LoginCredentials = {
  username: string
  password: string
}

export const usernameFieldSelectors = [
  'input[type="email"]',
  'input[type="text"][autocomplete~="username" i]',
  'input[type="text"][name*="user" i]',
  'input[type="text"][name*="email" i]',
  'input[type="text"][id*="user" i]',
  'input[type="text"][id*="email" i]',
] as const

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  if (descriptor?.set) {
    descriptor.set.call(input, value)
  } else {
    input.value = value
  }
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

export function findPasswordFields(
  root: ParentNode = document,
): HTMLInputElement[] {
  return Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter((field) => !field.disabled && field.type === 'password')
}

export function findUsernameFields(
  root: ParentNode = document,
): HTMLInputElement[] {
  return Array.from(
    root.querySelectorAll<HTMLInputElement>(usernameFieldSelectors.join(',')),
  ).filter((field) => !field.disabled)
}

export function summarizePasswordForms(
  root: ParentNode = document,
): PasswordFormSummary {
  const passwordFields = findPasswordFields(root)
  const usernameFields = findUsernameFields(root)
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

export function fillLoginCredentials(
  credentials: LoginCredentials,
  root: ParentNode = document,
): boolean {
  const passwordFields = findPasswordFields(root)
  if (passwordFields.length === 0) return false

  const passwordField = passwordFields[0]
  const form = passwordField.form
  const usernameCandidates = form
    ? findUsernameFields(form)
    : findUsernameFields(root)
  const usernameField = usernameCandidates[0]

  if (usernameField) {
    setNativeInputValue(usernameField, credentials.username)
  }
  setNativeInputValue(passwordField, credentials.password)
  return true
}

export function submitLoginForm(root: ParentNode = document): boolean {
  const passwordField = findPasswordFields(root)[0]
  if (!passwordField) return false
  const form = passwordField.form
  if (!form) {
    passwordField.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
      }),
    )
    return true
  }

  const submitControl = form.querySelector<HTMLElement>(
    'button[type="submit"], input[type="submit"], button:not([type])',
  )
  if (submitControl) {
    submitControl.click()
    return true
  }
  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit()
    return true
  }
  form.submit()
  return true
}
