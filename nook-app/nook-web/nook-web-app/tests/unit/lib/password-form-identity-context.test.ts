import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationWorkflowFormsHaveActionableControl,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'

afterEach(() => {
  document.body.replaceChildren()
})

describe('authentication form identity context', () => {
  test('accepts localized password-only submits with accessible login form identity', () => {
    for (const form of [
      '<form name="login"><input type="password" autocomplete="current-password" /><button type="submit">Entrar</button></form>',
      '<h2 id="login-heading">Login</h2><form aria-labelledby="login-heading"><input type="password" autocomplete="current-password" /><button type="submit">Entrar</button></form>',
    ]) {
      document.body.innerHTML = form
      expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
        currentPasswordFieldCount: 1,
        authenticationAdvanceControlPresent: true,
      })
    }
  })

  test('accepts an explicit form-less login scope rooted at main', () => {
    document.body.innerHTML = `
      <main id="login">
        <input autocomplete="username" />
        <button type="button">Siguiente</button>
      </main>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.formScope.kind).toBe('locally-scoped')
    expect(observations[0]?.summary).toMatchObject({
      authenticationAdvanceControlPresent: true,
    })
  })

  test('rejects a generic advance label on an email newsletter', () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="email" name="newsletter" />
        <button type="submit">Continue</button>
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
})
