import { afterEach, describe, expect, test } from 'vitest'
import {
  installIsolatedAuthenticationDirectSubmitBridge,
  installPageAuthenticationDirectSubmitBridge,
} from '../../../../nook-web-shared/src/extension/authentication-direct-submit-bridge'
import {
  authenticationPageObservationFacts,
  clearLoginCredentials,
  fillLoginCredentials,
  FormSubmissionResult,
  PasswordFormQueryKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'

function observedAuthenticationWorkflow() {
  const observation = summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

function authenticationFacts() {
  return authenticationPageObservationFacts({
    observation: observedAuthenticationWorkflow(),
    authenticatorSetupHint: false,
    backupCodesHint: false,
  })
}

function fillTrackedCredentials() {
  const request: Parameters<typeof fillLoginCredentials>[0] = {
    credentials: { username: 'vault-user', password: 'vault-password' },
    kind: PasswordFormQueryKind.Root,
    root: document,
  }
  expect(fillLoginCredentials(request)).toBe(true)
  return request
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('credential submission observation facts', () => {
  test('binds the selected owned POST submission', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Delete account</button>
        <button type="submit">Sign in</button>
      </form>
    `

    expect(authenticationFacts().credentialSubmission).toMatchObject({
      kind: 'observed',
      facts: {
        method: 'post',
        formIdentity: 'login',
        destinationIdentity: expect.stringContaining('/login'),
      },
    })
  })

  test('binds an actionable implicit owned POST submission', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
    `

    expect(authenticationFacts().credentialSubmission).toMatchObject({
      kind: 'observed',
      facts: {
        actionability: 'actionable',
        method: 'post',
        destinationIdentity: expect.stringContaining('/session'),
      },
    })
  })

  test('does not bind a custom button activation to the form route', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="button">Sign in</button>
      </form>
    `

    expect(authenticationFacts().credentialSubmission).toEqual({
      kind: 'absent',
    })
  })

  test('binds the same semantic control that activation prioritizes', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="button">Continue</button>
        <button type="submit" formaction="/approved-login">Sign in</button>
      </form>
    `

    expect(authenticationFacts().credentialSubmission).toMatchObject({
      kind: 'observed',
      facts: {
        method: 'post',
        destinationIdentity: expect.stringContaining('/approved-login'),
      },
    })
  })

  test('binds readonly and effectively disabled password-field transitions', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" readonly />
        <fieldset id="password-fields">
          <input type="password" autocomplete="current-password" />
        </fieldset>
        <button type="submit">Sign in</button>
      </form>
    `

    expect(authenticationFacts().fields).toMatchObject({
      currentPasswordFieldCount: 2,
      actionablePasswordFieldCount: 1,
      readonlyPasswordFieldCount: 1,
    })

    const readonlyOnly =
      document.querySelector<HTMLInputElement>('input[readonly]')
    document
      .querySelector<HTMLFieldSetElement>('#password-fields')
      ?.setAttribute('disabled', '')
    expect(
      fillLoginCredentials({
        credentials: { username: 'vault-user', password: 'vault-password' },
        kind: PasswordFormQueryKind.Root,
        root: document,
      }),
    ).toBe(false)
    expect(readonlyOnly?.value).toBe('')

    expect(authenticationFacts().fields).toMatchObject({
      currentPasswordFieldCount: 1,
      actionablePasswordFieldCount: 0,
      readonlyPasswordFieldCount: 1,
    })
  })

  test('rechecks readonly state after filling the username', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const username = document.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]',
    )
    const password = document.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )
    if (!username || !password) throw new Error('expected login fields')
    username.addEventListener('input', () => {
      password.readOnly = true
    })

    expect(
      fillLoginCredentials({
        credentials: { username: 'vault-user', password: 'vault-password' },
        kind: PasswordFormQueryKind.Root,
        root: document,
      }),
    ).toBe(false)
    expect(password.value).toBe('')
  })

  test('rejects a route changed by the selected submitter click handler', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const form = document.querySelector<HTMLFormElement>('#login')
    const button = form?.querySelector<HTMLButtonElement>('button')
    if (!form || !button) throw new Error('expected login controls')
    const approvedAction = form.action
    const fillRequest = fillTrackedCredentials()
    button.addEventListener('click', () => {
      const password = form.querySelector<HTMLInputElement>(
        'input[type="password"]',
      )
      if (password) password.style.display = 'none'
      const userPassword = document.createElement('input')
      userPassword.type = 'password'
      userPassword.dataset.user = 'true'
      userPassword.value = 'user-pin'
      form.append(userPassword)
      form.action = '/capture'
    })
    const request: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Root,
      root: document,
      submissionApproval: {
        isApproved: () => form.action === approvedAction,
        reject: () => clearLoginCredentials(fillRequest),
      },
    }

    expect(submitLoginForm(request)).toBe(FormSubmissionResult.Rejected)
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('')
    expect(document.querySelector<HTMLInputElement>('[data-user]')?.value).toBe(
      'user-pin',
    )
  })

  test('guards every submit emitted by one approved activation', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const form = document.querySelector<HTMLFormElement>('#login')
    const button = form?.querySelector<HTMLButtonElement>('button')
    if (!form || !button) throw new Error('expected login controls')
    const approvedAction = form.action
    button.addEventListener('click', () => {
      form.requestSubmit()
      form.action = '/capture'
    })
    form.addEventListener('submit', (event) => event.preventDefault())
    const clearRequest = fillTrackedCredentials()
    const request: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Root,
      root: document,
      submissionApproval: {
        isApproved: () => form.action === approvedAction,
        reject: () => clearLoginCredentials(clearRequest),
      },
    }

    expect(submitLoginForm(request)).toBe(FormSubmissionResult.Rejected)
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('')
  })

  test('rejects a route changed by a submit handler after capture', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const form = document.querySelector<HTMLFormElement>('#login')
    if (!form) throw new Error('expected login form')
    const approvedAction = form.action
    const clearRequest = fillTrackedCredentials()
    const stopIsolatedBridge = installIsolatedAuthenticationDirectSubmitBridge()
    const stopPageBridge = installPageAuthenticationDirectSubmitBridge()
    const pageSubmit = HTMLFormElement.prototype.submit
    form.addEventListener('submit', () => {
      form.action = '/capture'
      pageSubmit.call(form)
    })
    try {
      expect(
        submitLoginForm({
          kind: PasswordFormQueryKind.Root,
          root: document,
          submissionApproval: {
            isApproved: () => form.action === approvedAction,
            reject: () => clearLoginCredentials(clearRequest),
          },
        }),
      ).toBe(FormSubmissionResult.Rejected)
      expect(
        document.querySelector<HTMLInputElement>('input[type="password"]')
          ?.value,
      ).toBe('')
    } finally {
      stopPageBridge()
      stopIsolatedBridge()
    }
  })

  test('preserves a page-managed cancelled login submission', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const form = document.querySelector<HTMLFormElement>('#login')
    if (!form) throw new Error('expected login form')
    fillTrackedCredentials()
    let submissionCount = 0
    form.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return
      submissionCount += 1
      event.preventDefault()
    })

    expect(
      submitLoginForm({
        kind: PasswordFormQueryKind.Root,
        root: document,
        submissionApproval: { isApproved: () => true, reject: () => {} },
      }),
    ).toBe(FormSubmissionResult.Submitted)
    expect(submissionCount).toBe(1)
  })

  test('preserves cancellation from a window bubble submit handler', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
    `
    fillTrackedCredentials()
    let submissionCount = 0
    const cancelAtWindow = (event: Event) => {
      if (event.defaultPrevented) return
      submissionCount += 1
      event.preventDefault()
    }
    window.addEventListener('submit', cancelAtWindow)

    try {
      expect(
        submitLoginForm({
          kind: PasswordFormQueryKind.Root,
          root: document,
          submissionApproval: { isApproved: () => true, reject: () => {} },
        }),
      ).toBe(FormSubmissionResult.Submitted)
      expect(submissionCount).toBe(1)
    } finally {
      window.removeEventListener('submit', cancelAtWindow)
    }
  })

  test('starts rollback tracking fresh for each fill attempt', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
    `
    const form = document.querySelector<HTMLFormElement>('#login')
    const oldPassword = form?.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )
    if (!form || !oldPassword) throw new Error('expected login controls')
    fillTrackedCredentials()
    oldPassword.value = 'user-retained'
    form.innerHTML = `
      <input autocomplete="username" />
      <input type="password" autocomplete="current-password" />
    `
    const latestFill = fillTrackedCredentials()

    clearLoginCredentials(latestFill)

    expect(oldPassword.value).toBe('user-retained')
    expect(
      form.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('')
  })

  test('rejects a submitter override emitted by the approved click handler', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit" id="approved">Sign in</button>
        <button type="submit" id="alternate" formaction="/capture">Alternate</button>
      </form>
    `
    const form = document.querySelector<HTMLFormElement>('#login')
    const approved = document.querySelector<HTMLButtonElement>('#approved')
    const alternate = document.querySelector<HTMLButtonElement>('#alternate')
    if (!form || !approved || !alternate)
      throw new Error('expected login controls')
    approved.addEventListener('click', () => form.requestSubmit(alternate))
    form.addEventListener('submit', (event) => event.preventDefault())
    const clearRequest = fillTrackedCredentials()

    expect(
      submitLoginForm({
        kind: PasswordFormQueryKind.Root,
        root: document,
        submissionApproval: {
          isApproved: () => true,
          reject: () => clearLoginCredentials(clearRequest),
        },
      }),
    ).toBe(FormSubmissionResult.Rejected)
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('')
  })
})
