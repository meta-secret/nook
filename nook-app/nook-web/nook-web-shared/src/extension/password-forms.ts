export type PasswordFormSummary = {
  passwordFieldCount: number
  usernameFieldCount: number
  oneTimeCodeFieldCount: number
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

export const oneTimeCodeFieldSelectors = [
  'input[autocomplete~="one-time-code" i]',
  'input[name*="totp" i]',
  'input[id*="totp" i]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="2fa" i]',
  'input[id*="2fa" i]',
  'input[name*="mfa" i]',
  'input[id*="mfa" i]',
  'input[name*="auth-code" i]',
  'input[id*="auth-code" i]',
  'input[name*="verification-code" i]',
  'input[id*="verification-code" i]',
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

function isRenderedInput(field: HTMLInputElement): boolean {
  let element: HTMLElement | undefined = field
  while (element) {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
      return false
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    if (style?.display === 'none' || style?.visibility === 'hidden') {
      return false
    }
    element = element.parentElement ?? undefined
  }
  return true
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

export function findOneTimeCodeFields(
  root: ParentNode = document,
): HTMLInputElement[] {
  return Array.from(
    root.querySelectorAll<HTMLInputElement>(
      oneTimeCodeFieldSelectors.join(','),
    ),
  ).filter(
    (field) =>
      !field.disabled &&
      !field.readOnly &&
      isRenderedInput(field) &&
      ['text', 'tel', 'number', 'password'].includes(field.type),
  )
}

export function summarizePasswordForms(
  root: ParentNode = document,
): PasswordFormSummary {
  const passwordFields = findPasswordFields(root)
  const usernameFields = findUsernameFields(root)
  const oneTimeCodeFields = findOneTimeCodeFields(root)
  const forms = new Set<HTMLFormElement>()

  for (const field of [
    ...passwordFields,
    ...usernameFields,
    ...oneTimeCodeFields,
  ]) {
    if (field.form) {
      forms.add(field.form)
    }
  }

  return {
    passwordFieldCount: passwordFields.length,
    usernameFieldCount: usernameFields.length,
    oneTimeCodeFieldCount: oneTimeCodeFields.length,
    formCount: forms.size,
    observedAt: Date.now(),
  }
}

export function fillOneTimeCode(
  code: string,
  root: ParentNode = document,
): boolean {
  const field = findOneTimeCodeFields(root)[0]
  if (!field) return false
  setNativeInputValue(field, code)
  field.focus()
  return true
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
