import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  authenticationWorkflowFormsHaveActionableControl,
  PasswordFormScopeKind,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { isActionablePageControl } from '../../../../nook-web-shared/src/extension/password-form-fields'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('website authentication control actionability', () => {
  test('rejects credential forms hidden by content visibility', () => {
    document.body.innerHTML = `
      <section style="content-visibility: hidden">
        <form>
          <input type="email" autocomplete="username" />
          <button type="submit">Sign in</button>
        </form>
      </section>
    `

    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
  })

  test('rejects a non-focusable custom role button', () => {
    document.body.innerHTML = `
      <section>
        <input type="email" autocomplete="username" />
        <div role="button">Continue</div>
      </section>
    `

    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
  })

  test('rejects credential forms inside fully clipped subtrees', () => {
    document.body.innerHTML = `
      <section style="clip-path: inset(50%)">
        <form id="login">
          <input type="email" autocomplete="username" />
          <button type="submit">Sign in</button>
        </form>
      </section>
    `

    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
  })

  test('rejects controls fully clipped by non-inset basic shapes', () => {
    const fullyClippingShapes = [
      'circle(0)',
      'ellipse(0 50%)',
      'polygon(0 0, 50% 50%, 100% 100%)',
    ]
    for (const clipPath of fullyClippingShapes) {
      document.body.innerHTML = `<button type="submit" style="clip-path: ${clipPath}">Sign in</button>`
      const submit = document.querySelector('button')

      expect(submit).toBeTruthy()
      if (!submit) return
      expect(isActionablePageControl(submit)).toBe(false)
    }
  })

  test('keeps rounded inset controls actionable when offsets do not clip them', () => {
    document.body.innerHTML = `
      <form id="login">
        <input type="email" autocomplete="username" />
        <button type="submit" style="clip-path: inset(0 round 50%)">Sign in</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      authenticationAdvanceControlPresent: true,
    })
  })

  test('rejects a control fully clipped by absolute insets', () => {
    document.body.innerHTML = `
      <button type="submit" style="clip-path: inset(100px)">Sign in</button>
    `
    const submit = document.querySelector('button')
    expect(submit).toBeTruthy()
    if (!submit) return
    const bounds = submit.getBoundingClientRect()
    Object.defineProperties(bounds, {
      bottom: { value: 44 },
      height: { value: 32 },
      left: { value: 12 },
      right: { value: 112 },
      top: { value: 12 },
      width: { value: 100 },
      x: { value: 12 },
      y: { value: 12 },
    })
    submit.getBoundingClientRect = () => bounds

    expect(isActionablePageControl(submit)).toBe(false)
  })

  test('rejects credential forms with collapsed visibility', () => {
    document.body.innerHTML = `
      <form id="login" style="visibility: collapse">
        <input type="email" autocomplete="username" />
        <button type="submit">Sign in</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
  })

  test('honors a control that restores inherited visibility', () => {
    document.body.innerHTML = `
      <section style="visibility: hidden">
        <button type="submit" style="visibility: visible">Sign in</button>
      </section>
    `
    const submit = document.querySelector('button')

    expect(submit).toBeTruthy()
    if (!submit) return
    expect(isActionablePageControl(submit)).toBe(true)
  })

  test('rejects a credential submit outside the rendered viewport', () => {
    document.body.innerHTML = `
      <form id="login">
        <input type="email" autocomplete="username" />
        <button type="submit">Sign in</button>
      </form>
    `
    const submit = document.querySelector('button')
    expect(submit).toBeTruthy()
    if (!submit) return
    const offscreenBounds = submit.getBoundingClientRect()
    Object.defineProperties(offscreenBounds, {
      bottom: { value: 44 },
      height: { value: 32 },
      left: { value: -10_000 },
      right: { value: -9_900 },
      top: { value: 12 },
      width: { value: 100 },
      x: { value: -10_000 },
      y: { value: 12 },
    })
    submit.getBoundingClientRect = () => offscreenBounds

    expect(isActionablePageControl(submit)).toBe(false)
  })

  test('requires positive viewport intersection at the left boundary', () => {
    document.body.innerHTML = '<button type="submit">Sign in</button>'
    const submit = document.querySelector('button')
    expect(submit).toBeTruthy()
    if (!submit) return
    const boundaryBounds = submit.getBoundingClientRect()
    Object.defineProperties(boundaryBounds, {
      bottom: { value: 44 },
      height: { value: 32 },
      left: { value: -100 },
      right: { value: 0 },
      top: { value: 12 },
      width: { value: 100 },
      x: { value: -100 },
      y: { value: 12 },
    })
    submit.getBoundingClientRect = () => boundaryBounds

    expect(isActionablePageControl(submit)).toBe(false)
  })

  test('rejects a submit fully clipped by ancestor overflow', () => {
    document.body.innerHTML = `
      <section style="overflow: hidden">
        <button type="submit">Sign in</button>
      </section>
    `
    const section = document.querySelector('section')
    const submit = document.querySelector('button')
    expect(section).toBeTruthy()
    expect(submit).toBeTruthy()
    if (!section || !submit) return
    const sectionBounds = section.getBoundingClientRect()
    Object.defineProperties(sectionBounds, {
      bottom: { value: 40 },
      height: { value: 40 },
      left: { value: 0 },
      right: { value: 100 },
      top: { value: 0 },
      width: { value: 100 },
      x: { value: 0 },
      y: { value: 0 },
    })
    section.getBoundingClientRect = () => sectionBounds
    const submitBounds = submit.getBoundingClientRect()
    Object.defineProperties(submitBounds, {
      bottom: { value: 82 },
      height: { value: 32 },
      left: { value: 0 },
      right: { value: 100 },
      top: { value: 50 },
      width: { value: 100 },
      x: { value: 0 },
      y: { value: 50 },
    })
    submit.getBoundingClientRect = () => submitBounds

    expect(isActionablePageControl(submit)).toBe(false)
  })

  test('rejects a zero-area credential submit', () => {
    document.body.innerHTML = '<button type="submit">Sign in</button>'
    const submit = document.querySelector('button')
    expect(submit).toBeTruthy()
    if (!submit) return
    const zeroAreaBounds = submit.getBoundingClientRect()
    Object.defineProperties(zeroAreaBounds, {
      bottom: { value: 0 },
      height: { value: 0 },
      left: { value: 0 },
      right: { value: 0 },
      top: { value: 0 },
      width: { value: 0 },
      x: { value: 0 },
      y: { value: 0 },
    })
    submit.getBoundingClientRect = () => zeroAreaBounds

    expect(isActionablePageControl(submit)).toBe(false)
  })

  test('rejects a credential submit fully covered by another hit target', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" />
        <button type="submit">Sign in</button>
      </form>
      <div id="overlay"></div>
    `
    const submit = document.querySelector('button')
    const overlay = document.querySelector('#overlay')
    expect(submit).toBeTruthy()
    expect(overlay).toBeTruthy()
    if (!submit || !overlay) return
    const hitTest = vi
      .spyOn(document, 'elementFromPoint')
      .mockReturnValue(overlay)

    expect(isActionablePageControl(submit)).toBe(false)
    expect(hitTest.mock.calls.length).toBeLessThanOrEqual(265)
    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
  })

  test('accepts a credential submit with an exposed edge midpoint', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" />
        <button type="submit">Sign in</button>
      </form>
      <div id="overlay"></div>
    `
    const submit = document.querySelector('button')
    const overlay = document.querySelector('#overlay')
    expect(submit).toBeTruthy()
    expect(overlay).toBeTruthy()
    if (!submit || !overlay) return
    const bounds = submit.getBoundingClientRect()
    Object.defineProperties(bounds, {
      bottom: { value: 44 },
      height: { value: 32 },
      left: { value: 12 },
      right: { value: 112 },
      top: { value: 12 },
      width: { value: 100 },
      x: { value: 12 },
      y: { value: 12 },
    })
    submit.getBoundingClientRect = () => bounds
    vi.spyOn(document, 'elementFromPoint').mockImplementation((x, y) =>
      x === 62 && y === 13 ? submit : overlay,
    )

    expect(isActionablePageControl(submit)).toBe(true)
  })

  test('honors an actionable control that restores pointer events', () => {
    document.body.innerHTML = `
      <section style="pointer-events: none">
        <form id="login">
          <input type="email" autocomplete="username" />
          <button type="submit" style="pointer-events: auto">Sign in</button>
        </form>
      </section>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      authenticationAdvanceControlPresent: true,
    })
  })

  test('requires progression evidence for a standalone one-time-code field', () => {
    const challenges = [
      '<input autocomplete="one-time-code" inputmode="numeric" />',
      '<input autocomplete="one-time-code" inputmode="numeric" /><button type="submit" hidden>Verify</button>',
      '<input autocomplete="one-time-code" inputmode="numeric" /><button type="submit" disabled>Verify</button>',
    ]

    for (const challenge of challenges) {
      document.body.innerHTML = `<form>${challenge}</form>`
      const observations = summarizeAuthenticationWorkflowForms()
      const actionabilityQuery: Parameters<
        typeof authenticationWorkflowFormsHaveActionableControl
      >[0] = { observations }
      expect(
        authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
      ).toBe(false)
    }
  })

  test('accepts direct one-time-code auto-submit DOM evidence', () => {
    document.body.innerHTML = `
      <form>
        <input
          autocomplete="one-time-code"
          inputmode="numeric"
          oninput="this.form.requestSubmit()"
        />
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityQuery: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }
    expect(observations[0]?.summary).toMatchObject({
      oneTimeCodeFieldCount: 1,
      oneTimeCodeAutoSubmitObserved: true,
      authenticationAdvanceControlPresent: false,
    })
    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
    ).toBe(true)
  })

  test('rejects SubmitEvent construction as one-time-code progression', () => {
    for (const handler of [
      "void new SubmitEvent('submit')",
      "this.form.dispatchEvent(new SubmitEvent('submit'))",
      'validator.submit()',
      'analytics.requestSubmit()',
    ]) {
      document.body.innerHTML = `
        <form>
          <input autocomplete="one-time-code" oninput="${handler}" />
        </form>
      `
      const observations = summarizeAuthenticationWorkflowForms()
      const actionabilityQuery: Parameters<
        typeof authenticationWorkflowFormsHaveActionableControl
      >[0] = { observations }
      expect(observations[0]?.summary.oneTimeCodeAutoSubmitObserved).toBe(false)
      expect(
        authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
      ).toBe(false)
    }
  })

  test('accepts a localized submit with explicit username evidence', () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username" />
        <button type="submit">Entrar</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts a localized submit on a password-only login step', () => {
    document.body.innerHTML = `
      <form>
        <input type="password" autocomplete="current-password" />
        <button type="submit">Anmelden</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      passwordFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts Save changes when a new password field is present', () => {
    document.body.innerHTML = `
      <form id="account-settings">
        <input type="password" autocomplete="new-password" />
        <button type="submit">Save changes</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      newPasswordFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('rejects a username-only recovery form default action', () => {
    document.body.innerHTML = `
      <form action="/password/recover">
        <input autocomplete="username" />
        <button type="submit">Continuar</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: false,
    })
  })

  test('accepts direct form-less login controls under main', () => {
    document.body.innerHTML = `
      <main>
        <input autocomplete="username" />
        <button type="button">Continue</button>
      </main>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts a localized submit with strong loginfmt evidence', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="loginfmt" />
        <button type="submit">Weiter</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityQuery: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
    ).toBe(true)
  })

  test('accepts a localized submit with standards-based email evidence', () => {
    document.body.innerHTML = `
      <form id="login">
        <input type="email" autocomplete="email" />
        <button type="submit">Entrar</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityQuery: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
    ).toBe(true)
  })

  test('rejects an email-only newsletter with a neutral semantic submit', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" autocomplete="email" name="address" />
        <button type="submit">Join</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityQuery: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }
    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
    ).toBe(false)
  })

  test('keeps localized settings and newsletter forms non-actionable', () => {
    for (const form of [
      '<form id="account-settings"><input autocomplete="email" /><button type="submit">Guardar</button></form>',
      '<form id="newsletter"><input name="newsletter-email" autocomplete="email" /><button type="submit">Continuar</button></form>',
    ]) {
      document.body.innerHTML = form
      const observations = summarizeAuthenticationWorkflowForms()
      const actionabilityQuery: Parameters<
        typeof authenticationWorkflowFormsHaveActionableControl
      >[0] = { observations }
      expect(
        authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
      ).toBe(false)
    }
  })

  test('does not let a passkey control unblock a disabled password change', () => {
    document.body.innerHTML = `
      <form id="account-settings">
        <input type="password" autocomplete="current-password" />
        <input type="password" autocomplete="new-password" />
        <input type="password" autocomplete="new-password" />
        <button type="submit" disabled>Save</button>
        <button type="button">Use a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityQuery: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }
    expect(observations[0]?.summary).toMatchObject({
      newPasswordFieldCount: 2,
      authenticationAdvanceControlPresent: false,
      passkeyControlPresent: true,
    })
    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
    ).toBe(false)
  })

  test('rejects popup actionability outside the Rust observation envelope', () => {
    const excessiveOneTimeCodeFields = new Array<string>(101)
      .fill('<input autocomplete="one-time-code" inputmode="numeric" />')
      .join('')
    document.body.innerHTML = `<form>${excessiveOneTimeCodeFields}</form>`

    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityQuery: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }
    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
    ).toBe(false)
  })

  test('classifies the prioritized prefix of oversized popup observations', () => {
    const inertForms = new Array<string>(20)
      .fill(
        '<form><input autocomplete="username" /><button type="submit" disabled>Continue</button></form>',
      )
      .join('')
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
      ${inertForms}
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityQuery: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }
    expect(observations).toHaveLength(21)
    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
    ).toBe(true)
  })

  test('does not share a manual checkpoint across unrelated forms', () => {
    document.body.innerHTML = `
      <form id="profile-editor">
        <input type="email" autocomplete="email" />
        <button type="submit" disabled>Save</button>
      </form>
      <form id="newsletter">
        <input type="checkbox" aria-label="I agree to the Terms" />
      </form>
      <iframe title="CAPTCHA"></iframe>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const profile = observations.find(
      ({ formScope }) =>
        formScope.kind === PasswordFormScopeKind.Owned &&
        formScope.owner.id === 'profile-editor',
    )
    const actionabilityQuery: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }
    expect(profile?.summary.manualCheckpointPresent).toBe(false)
    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
    ).toBe(false)
  })
})
