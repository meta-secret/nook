import { afterEach, describe, expect, test } from 'vitest'
import {
  AUTHENTICATION_SUBMIT_VALUE_SOURCE,
  authenticationFactAttributeFilter,
  authenticationFactMutationRequiresScan,
  authenticationFactObserverOptions,
  isAuthenticationSubmitValueMessage,
  notifyAuthenticationSubmitValueAssigned,
  observeAuthenticationSubmitValueAssignments,
} from '../../../../nook-web-shared/src/extension/authentication-fact-attributes'
import {
  authenticationPageObservationFacts,
  summarizeAuthenticationWorkflowForms,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'

function observedAuthenticationWorkflow(): PasswordFormObservation {
  const observation = summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('authentication fact rescans', () => {
  test('ignores unrelated animation attributes but rescans auth scopes', () => {
    document.body.innerHTML = `
      <div id="animation"></div>
      <section id="login-shell">
        <form id="login" method="post">
          <input id="username" autocomplete="username" />
          <button id="submit" type="submit">Sign in</button>
        </form>
      </section>
      <button id="external" type="submit" form="login">Continue</button>
      <section id="label-shell"><span id="passkey-label">Use passkey</span></section>
      <div id="passkey" data-nook-passkey-control aria-labelledby="passkey-label"></div>
    `
    const mutationFor = (
      target: Element,
    ): Parameters<typeof authenticationFactMutationRequiresScan>[0] => ({
      type: 'attributes',
      target,
    })
    const animation = document.querySelector('#animation')
    const username = document.querySelector('#username')
    const loginShell = document.querySelector('#login-shell')
    const external = document.querySelector('#external')
    const passkey = document.querySelector('#passkey')
    const passkeyLabel = document.querySelector('#passkey-label')
    const labelShell = document.querySelector('#label-shell')
    if (
      !animation ||
      !username ||
      !loginShell ||
      !external ||
      !passkey ||
      !passkeyLabel ||
      !labelShell
    ) {
      throw new Error('expected authentication mutation fixtures')
    }

    expect(authenticationFactMutationRequiresScan(mutationFor(animation))).toBe(
      false,
    )
    expect(
      authenticationFactMutationRequiresScan({
        ...mutationFor(animation),
        attributeName: 'style',
      }),
    ).toBe(false)
    for (const relevant of [
      username,
      loginShell,
      external,
      passkey,
      passkeyLabel,
      labelShell,
    ]) {
      expect(
        authenticationFactMutationRequiresScan(mutationFor(relevant)),
      ).toBe(true)
    }
    passkeyLabel.id = 'renamed-passkey-label'
    expect(
      authenticationFactMutationRequiresScan({
        ...mutationFor(passkeyLabel),
        attributeName: 'id',
        oldValue: 'passkey-label',
      }),
    ).toBe(true)
    passkey.removeAttribute('data-nook-passkey-control')
    expect(
      authenticationFactMutationRequiresScan({
        ...mutationFor(passkey),
        attributeName: 'data-nook-passkey-control',
        oldValue: '',
      }),
    ).toBe(true)
  })

  test('watches remaining fact-bearing identities used by observation facts', () => {
    expect(authenticationFactAttributeFilter).toEqual(
      expect.arrayContaining([
        'alt',
        'data-qa',
        'data-testid',
        'data-nook-manual-checkpoint',
        'for',
        'formmethod',
        'inert',
        'method',
        'onchange',
        'oninput',
        'open',
        'placeholder',
        'readonly',
        'role',
        'src',
        'title',
        'value',
      ]),
    )
    expect(authenticationFactObserverOptions.characterData).toBe(true)
    const ticker = document.createTextNode('0')
    const label = document.createElement('button')
    label.textContent = 'Sign in'
    document.body.append(ticker, label)
    const tickerMutation: Parameters<
      typeof authenticationFactMutationRequiresScan
    >[0] = {
      type: 'characterData',
      target: ticker,
    }
    const labelChild = label.childNodes[0]
    const labelMutation: Parameters<
      typeof authenticationFactMutationRequiresScan
    >[0] = {
      type: 'characterData',
      target: labelChild ? labelChild : label,
    }
    expect(authenticationFactMutationRequiresScan(tickerMutation)).toBe(false)
    expect(authenticationFactMutationRequiresScan(labelMutation)).toBe(true)
    document.body.innerHTML = `
      <span id="passkey-label"><strong>Use passkey</strong></span>
      <div data-nook-passkey-control aria-labelledby="passkey-label"><svg></svg></div>
    `
    const referencedLabel = document.querySelector('strong')
    const referencedLabelChild = referencedLabel?.childNodes[0]
    const referencedLabelMutation: Parameters<
      typeof authenticationFactMutationRequiresScan
    >[0] = {
      type: 'characterData',
      target: referencedLabelChild ? referencedLabelChild : document.body,
    }
    expect(
      authenticationFactMutationRequiresScan(referencedLabelMutation),
    ).toBe(true)
    document.body.innerHTML = `
      <div data-nook-passkey-control><strong>Add passkey</strong></div>
    `
    const markedLabel = document.querySelector('strong')?.childNodes[0]
    const markedMutation: Parameters<
      typeof authenticationFactMutationRequiresScan
    >[0] = {
      type: 'characterData',
      target: markedLabel ? markedLabel : document.body,
    }
    expect(authenticationFactMutationRequiresScan(markedMutation)).toBe(true)
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/login" role="form">
        <input autocomplete="username" />
        <input type="submit" value="Delete" title="Remove account" />
      </form>
    `
    const before = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(before.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          label: expect.stringContaining('Delete'),
          formIdentity: expect.stringContaining('Login'),
        },
      ],
    })

    const submitter = document.querySelector('input[type="submit"]')
    submitter?.setAttribute('value', 'Sign in')
    submitter?.setAttribute('title', 'Sign in')
    document.querySelector('form')?.setAttribute('role', 'search')

    const after = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(after.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          label: expect.stringContaining('Sign in'),
          formIdentity: expect.stringContaining('Login'),
        },
      ],
    })
  })

  test('rescans after label for, iframe src, or checkpoint attributes change', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/auth/login">
        <label id="email-label">Email</label>
        <input id="contact" type="text" />
        <input type="password" autocomplete="current-password" />
        <iframe id="gate" title="Verification"></iframe>
        <button type="submit">Sign in</button>
      </form>
    `
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(0)
    expect(
      observedAuthenticationWorkflow().summary.manualCheckpointPresent,
    ).toBe(false)
    document.querySelector('#email-label')?.setAttribute('for', 'contact')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
    document
      .querySelector('#gate')
      ?.setAttribute('src', 'https://hcaptcha.test')
    expect(
      observedAuthenticationWorkflow().summary.manualCheckpointPresent,
    ).toBe(true)
    document.querySelector('#gate')?.removeAttribute('src')
    expect(
      observedAuthenticationWorkflow().summary.manualCheckpointPresent,
    ).toBe(false)
    document
      .querySelector('#gate')
      ?.setAttribute('data-nook-manual-checkpoint', '')
    expect(
      observedAuthenticationWorkflow().summary.manualCheckpointPresent,
    ).toBe(true)
  })

  test('rescans a readonly username field after it becomes editable', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/auth/login">
        <input autocomplete="username" readonly />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(0)
    document
      .querySelector('input[autocomplete="username"]')
      ?.removeAttribute('readonly')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
  })

  test('rescans a text field after data-testid or placeholder identify it', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/auth/login">
        <input id="contact-field" type="text" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(0)
    const field = document.querySelector('#contact-field')
    if (!field) {
      throw new Error('expected the unclassified username field')
    }
    field.setAttribute('placeholder', 'Email or username')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
    field.removeAttribute('placeholder')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(0)
    field.setAttribute('data-testid', 'username')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
    field.removeAttribute('data-testid')
    field.setAttribute('data-qa', 'login_email')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
  })

  test('rescans OTP handler facts when oninput or onchange mutate', () => {
    document.body.innerHTML = `
      <form method="post" id="otp-login" action="/mfa/challenge">
        <input autocomplete="one-time-code" />
        <button type="submit">Verify code</button>
      </form>
    `
    const field = document.querySelector('input')
    if (!field) {
      throw new Error('expected OTP field')
    }

    const before = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(before.ceremony.oneTimeCodeHandlerSignals).toEqual([])

    field.setAttribute('oninput', 'this.form.requestSubmit()')
    field.setAttribute('onchange', 'validateCode()')
    const afterAdd = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(afterAdd.ceremony.oneTimeCodeHandlerSignals).toEqual([
      'oninput=this.form.requestSubmit()',
      'onchange=validateCode()',
    ])

    field.removeAttribute('oninput')
    field.removeAttribute('onchange')
    const afterRemove = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(afterRemove.ceremony.oneTimeCodeHandlerSignals).toEqual([])
  })

  test('rescans submission method when a form method attribute changes', () => {
    document.body.innerHTML = `
      <form id="login" method="get" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const before = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const beforeControl = before.detailedAdvanceControl
    expect(beforeControl ? beforeControl.kind : 'absent').toBe('absent')
    document.querySelector('form')?.setAttribute('method', 'post')
    const after = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(after.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ submissionMethod: 'post' }],
    })
  })

  test('rescans after a submit input value property assignment', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <input id="advance" type="submit" value="Resend code" />
      </form>
    `
    const submitter = document.querySelector('#advance')
    if (!(submitter instanceof HTMLInputElement)) {
      throw new Error('expected the submit input')
    }
    const before = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(before.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ label: expect.stringContaining('Resend code') }],
    })
    let rescans = 0
    const stop = observeAuthenticationSubmitValueAssignments(() => {
      rescans += 1
    })
    submitter.value = 'Verify code'
    expect(rescans).toBe(1)
    const after = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(after.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ label: expect.stringContaining('Verify code') }],
    })
    stop()
  })

  test('rescans after a type-button value property assignment', () => {
    document.body.innerHTML = `
      <div class="signin-panel">
        <input autocomplete="username" />
        <input id="advance" type="button" value="More options" />
      </div>
    `
    const advance = document.querySelector('#advance')
    if (!(advance instanceof HTMLInputElement)) {
      throw new Error('expected the type-button control')
    }
    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
    let rescans = 0
    const stop = observeAuthenticationSubmitValueAssignments(() => {
      rescans += 1
    })
    advance.value = 'Sign in'
    expect(rescans).toBe(1)
    expect(summarizeAuthenticationWorkflowForms()[0]?.formScope.kind).toBe(
      'unowned',
    )
    stop()
  })

  test('rescans a closed dialog after it opens', () => {
    document.body.innerHTML = `
      <dialog>
        <form method="post" action="/auth/login">
          <input autocomplete="username" />
          <input type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
      </dialog>
    `
    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
    document.querySelector('dialog')?.setAttribute('open', '')
    expect(
      summarizeAuthenticationWorkflowForms()[0]?.summary.passwordFieldCount,
    ).toBe(1)
  })

  test('bridges MAIN-world submit value assignments to the isolated listener', () => {
    const posted: Array<{ message: unknown; targetOrigin: string }> = []
    const originalPostMessage = window.postMessage.bind(window)
    window.postMessage = ((message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin })
    }) as typeof window.postMessage
    notifyAuthenticationSubmitValueAssigned()
    window.postMessage = originalPostMessage

    expect(posted).toEqual([
      {
        message: { source: AUTHENTICATION_SUBMIT_VALUE_SOURCE },
        targetOrigin: location.origin,
      },
    ])
    const event = new MessageEvent('message', {
      data: { source: AUTHENTICATION_SUBMIT_VALUE_SOURCE },
      origin: location.origin,
      source: window,
    })
    expect(isAuthenticationSubmitValueMessage(event)).toBe(true)
    expect(AUTHENTICATION_SUBMIT_VALUE_SOURCE).toBe(
      'nook-authentication-submit-value-v1',
    )
  })

  test('does not post submit-value notifications to an opaque origin', () => {
    const posted: Array<{ message: unknown; targetOrigin: string }> = []
    const originalPostMessage = window.postMessage.bind(window)
    window.postMessage = ((message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin })
      if (targetOrigin === 'null') {
        throw new Error('opaque origin')
      }
    }) as typeof window.postMessage
    const originalOrigin = location.origin
    Object.defineProperty(location, 'origin', {
      configurable: true,
      value: 'null',
    })
    expect(() => notifyAuthenticationSubmitValueAssigned()).not.toThrow()
    expect(posted).toEqual([])
    Object.defineProperty(location, 'origin', {
      configurable: true,
      value: originalOrigin,
    })
    window.postMessage = originalPostMessage
    expect(
      isAuthenticationSubmitValueMessage(
        new MessageEvent('message', {
          data: { source: AUTHENTICATION_SUBMIT_VALUE_SOURCE },
          origin: 'null',
          source: window,
        }),
      ),
    ).toBe(false)
  })
})
