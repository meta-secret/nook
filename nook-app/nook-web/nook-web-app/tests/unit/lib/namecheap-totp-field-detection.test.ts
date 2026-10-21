// @vitest-environment-options { "url": "https://www.namecheap.com/twofa/totp/?ReturnUrl=https%3a%2f%2fap.www.namecheap.com" }
import { afterEach, describe, expect, test } from 'vitest'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  classify_companion_authentication_workflow_facts,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { passwordFormInteraction } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  passwordFieldDiscovery,
  type PasswordFieldQuery,
} from '../../../../nook-web-shared/src/extension/password-form-fields'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  authenticationSurfaceObservation,
} from '../../../../nook-web-extension/src/content/autofill/authentication-surface-observation'

type WorkflowFacts = Parameters<
  typeof classify_companion_authentication_workflow_facts
>[0]
type ObservationFactsRequest = Parameters<
  typeof passwordFormInteraction.authenticationPageObservationFacts
>[0]

/** Namecheap's two-factor page: one page-wide ASP.NET form around the code panel. */
class NamecheapTwoFactorPage {
  static readonly ROUTE =
    '/twofa/totp/?ReturnUrl=https%3a%2f%2fap.www.namecheap.com'
  static readonly CONTROL =
    'ctl00$ctl00$ctl00$ctl00$base_content$web_base_content$home_content$page_content_left$ctl02$'
  static readonly WORDLESS_CODE_INPUT = `<input type="text" name="${NamecheapTwoFactorPage.CONTROL}tbValue" inputmode="numeric" maxlength="6" class="gb-form-control">`
  static readonly NAMED_CODE_INPUT = `<input type="text" name="${NamecheapTwoFactorPage.CONTROL}txtCode" inputmode="numeric" maxlength="6" class="gb-form-control">`
  static readonly MASKED_CODE_INPUT = `<input type="password" name="${NamecheapTwoFactorPage.CONTROL}txtCode" placeholder="Enter OTP Code" class="gb-form-control">`
  static readonly PLACEHOLDER_CODE_INPUT =
    '<input type="text" name="challenge" placeholder="Enter OTP Code">'
  static readonly LIVE_CODE_INPUT =
    '<input type="tel" class="gb-form-control gb-mb-small " autocomplete="off" placeholder="Enter OTP Code" data-ncid="verification-otp">'

  render(codeInput: string): void {
    const control = NamecheapTwoFactorPage.CONTROL
    document.body.innerHTML = `<style>.gb-dropdown__holder { display: none; }</style>
<form id="aspnetForm" name="aspnetForm" method="post" action="./?ReturnUrl=https%3a%2f%2fap.www.namecheap.com">
<input type="hidden" name="__VIEWSTATE" value="state">
<div class="gb-header"><div class="gb-dropdown gb-dropdown--sign-in"><a href="#">Sign in</a><div class="gb-dropdown__holder"><div class="gb-login-form"><fieldset>
<input data-ncid="input-login-username" type="text" name="LoginUserName" title="Username" placeholder="Username" maxlength="20">
<input data-ncid="input-login-password" type="password" name="LoginPassword" title="Password" placeholder="Password" maxlength="100">
<button type="button">Sign in</button></fieldset></div></div></div>
<input name="${control}siteSearchQuery" type="search" placeholder="Search Namecheap"><button type="submit">Search</button></div>
<div class="gb-scope twofa"><div class="gb-panel"><header class="gb-panel__header"><h2>Enter OTP Code</h2></header>
<div class="gb-panel__body"><p>Open the two-factor authentication app on your device to view your authentication code.</p>
${codeInput}
<a href="javascript:__doPostBack('${control}lnkBackup','')">Want to use a Backup Code?</a>
<input type="submit" name="${control}btnCancel" value="Cancel" class="gb-btn gb-btn--secondary">
<input type="submit" name="${control}btnSubmit" value="Submit" class="gb-btn gb-btn--primary">
</div></div></div>
<footer><input type="email" name="email" placeholder="you@yours.com" aria-labelledby="join-newsletter"><span id="join-newsletter">Join our newsletter</span><button type="button">Subscribe</button></footer>
</form>`
  }

  renderLiveChallenge(): void {
    document.body.innerHTML = `<fragment><fragment-app-test><div><form>
      <div><div><div class="gb-scope twofa"><div class="gb-panel">
        <header class="gb-panel__header"><h2>Enter OTP Code</h2></header>
        <div class="gb-panel__body">
          <label class="gb-d-block gb-mb-1">Open the two-factor authentication app on your device to view your authentication code.</label>
          ${NamecheapTwoFactorPage.LIVE_CODE_INPUT}
          <p class="gb-text-base gb-my-2"><a href="/twofa/backup/">Want to use a Backup Code?</a></p>
          <div><button type="button">Cancel</button><button type="submit">Submit</button></div>
        </div>
      </div></div></div></div>
    </form></div></fragment-app-test></fragment>`
  }

  codeFieldCount(): number {
    const query: PasswordFieldQuery = { root: document }
    return passwordFieldDiscovery.findOneTimeCodeFields(query).length
  }

  passwordFieldCount(): number {
    const query: PasswordFieldQuery = { root: document }
    return passwordFieldDiscovery.findPasswordFields(query).length
  }

  workflow() {
    const observations =
      passwordFormInteraction.summarizeAuthenticationWorkflowForms()
    const [observation] = observations
    if (!observation || observations.length !== 1) {
      throw new Error('expected one two-factor observation')
    }
    const factsRequest: ObservationFactsRequest = {
      observation,
      authenticatorSetupHint: 'absent',
    }
    const workflowFacts: WorkflowFacts = {
      observations: [
        passwordFormInteraction.authenticationPageObservationFacts(
          factsRequest,
        ),
      ],
    }
    const match =
      classify_companion_authentication_workflow_facts(workflowFacts)
    if (!('snapshot' in match)) throw new Error('expected a matched workflow')
    return match.snapshot
  }
}

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', NamecheapTwoFactorPage.ROUTE)
})

describe('Namecheap two-factor code field detection', () => {
  test('offers code fill for the observed unnamed GET form and telephone field', () => {
    const page = new NamecheapTwoFactorPage()
    page.renderLiveChallenge()
    expect(page.passwordFieldCount()).toBe(0)
    expect(page.codeFieldCount()).toBe(1)
    expect(page.workflow().kind).toBe(AuthenticationWorkflowKind.TotpChallenge)
    expect(page.workflow().action).toBe(AuthenticationWorkflowAction.FillTotp)
  })

  test.each([
    { initial: 'maxlength="6"', attribute: 'inputmode', value: 'numeric' },
    {
      initial: 'inputmode="numeric" maxlength="20"',
      attribute: 'maxlength',
      value: '6',
    },
    { initial: 'maxlength="6"', attribute: 'pattern', value: '[0-9]{6}' },
  ])(
    'rediscovers the challenge when $attribute supplies the missing entry hint',
    ({ initial, attribute, value }) => {
      const page = new NamecheapTwoFactorPage()
      window.history.replaceState({}, '', '/login')
      document.body.innerHTML = `<form method="post" action="/login"><input id="entry-code" type="text" ${initial}><button type="submit">Sign in</button></form>`
      expect(page.codeFieldCount()).toBe(0)
      const field = document.getElementById('entry-code')
      switch (field instanceof HTMLInputElement) {
        case false:
          throw new Error('Expected challenge field')
        case true:
          break
      }
      const observer = new MutationObserver(() => {})
      observer.observe(document.body, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [...AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER],
        subtree: true,
      })
      field.setAttribute(attribute, value)
      const records = observer.takeRecords()
      observer.disconnect()
      expect(records).toHaveLength(1)
      expect(
        authenticationSurfaceObservation.authenticationMutationImpact({
          records,
          mountedHost: false,
          renderedWorkflow: false,
        }).shouldScheduleScan,
      ).toBe(true)
      expect(page.codeFieldCount()).toBe(1)
      expect(page.workflow().action).toBe(AuthenticationWorkflowAction.FillTotp)
    },
  )

  test.each([
    {
      name: 'live unnamed telephone input with autocomplete off and placeholder only',
      codeInput: NamecheapTwoFactorPage.LIVE_CODE_INPUT,
    },
    {
      name: 'plain text input with the reported placeholder on initial load',
      codeInput: NamecheapTwoFactorPage.PLACEHOLDER_CODE_INPUT,
    },
    {
      name: 'wordless numeric code input',
      codeInput: NamecheapTwoFactorPage.WORDLESS_CODE_INPUT,
    },
    {
      name: 'numeric code input without OTP words',
      codeInput: NamecheapTwoFactorPage.NAMED_CODE_INPUT,
    },
  ])('offers TOTP fill for the $name', ({ codeInput }) => {
    const page = new NamecheapTwoFactorPage()
    page.render(codeInput)

    expect(page.codeFieldCount()).toBe(1)
    const snapshot = page.workflow()
    expect(snapshot.kind).toBe(AuthenticationWorkflowKind.TotpChallenge)
    expect(snapshot.action).toBe(AuthenticationWorkflowAction.FillTotp)
  })

  test('offers TOTP fill for a masked one-time-code input instead of a takeover', () => {
    const page = new NamecheapTwoFactorPage()
    page.render(NamecheapTwoFactorPage.MASKED_CODE_INPUT)

    expect(page.passwordFieldCount()).toBe(0)
    expect(page.codeFieldCount()).toBe(1)
    const snapshot = page.workflow()
    expect(snapshot.kind).toBe(AuthenticationWorkflowKind.TotpChallenge)
    expect(snapshot.action).toBe(AuthenticationWorkflowAction.FillTotp)
  })

  test('does not treat the wordless input as a code field on a non-auth path', () => {
    const page = new NamecheapTwoFactorPage()
    window.history.replaceState({}, '', '/cart/')
    page.render(NamecheapTwoFactorPage.WORDLESS_CODE_INPUT)
    expect(page.codeFieldCount()).toBe(0)

    window.history.replaceState({}, '', NamecheapTwoFactorPage.ROUTE)
    expect(page.codeFieldCount()).toBe(1)
  })
})
