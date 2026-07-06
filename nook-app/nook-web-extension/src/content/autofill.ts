export {}

type PasswordFormSummary = {
  passwordFieldCount: number
  usernameFieldCount: number
  formCount: number
  observedAt: number
}

const usernameFieldSelectors = [
  'input[type="email"]',
  'input[type="text"][autocomplete~="username" i]',
  'input[type="text"][name*="user" i]',
  'input[type="text"][name*="email" i]',
  'input[type="text"][id*="user" i]',
  'input[type="text"][id*="email" i]',
]

let pendingScan: number | undefined

function summarizePasswordForms(): PasswordFormSummary {
  const passwordFields = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  )
  const usernameFields = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      usernameFieldSelectors.join(','),
    ),
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

function sendSummary() {
  const summary = summarizePasswordForms()

  chrome.runtime.sendMessage(
    {
      type: 'nook:password-fields-detected',
      payload: summary,
    },
    () => {
      void chrome.runtime.lastError
    },
  )
}

function scheduleScan() {
  if (pendingScan !== undefined) {
    window.clearTimeout(pendingScan)
  }

  pendingScan = window.setTimeout(() => {
    pendingScan = undefined
    sendSummary()
  }, 150)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'nook:scan-password-fields'
  ) {
    const summary = summarizePasswordForms()
    sendResponse({ ok: true, summary })
    return false
  }

  return false
})

sendSummary()

const observer = new MutationObserver(scheduleScan)
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
})
