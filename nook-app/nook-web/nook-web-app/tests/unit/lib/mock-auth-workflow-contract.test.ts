import { cleanup, render } from '@testing-library/svelte'
import { afterEach, expect, test } from 'vitest'
import PlainLogin from '../../../../nook-web-extension/e2e/mock-auth/src/pages/PlainLogin.svelte'
import TotpLogin from '../../../../nook-web-extension/e2e/mock-auth/src/pages/TotpLogin.svelte'
import DetectionLogin from '../../../../nook-web-extension/e2e/mock-auth/src/pages/DetectionLogin.svelte'
import DetectionOtp from '../../../../nook-web-extension/e2e/mock-auth/src/pages/DetectionOtp.svelte'
import DetectionSignup from '../../../../nook-web-extension/e2e/mock-auth/src/pages/DetectionSignup.svelte'
import DetectionPasswordChange from '../../../../nook-web-extension/e2e/mock-auth/src/pages/DetectionPasswordChange.svelte'
import {
  classify_companion_authentication_workflow_facts,
  companion_authentication_workflow_match_kind,
  CompanionAuthenticationWorkflowMatchKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { classifiedAuthenticationWorkflowObservations } from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import { summarizeAuthenticationWorkflowForms } from '../../../../nook-web-shared/src/extension/password-forms'

afterEach(cleanup)

function classifyRenderedScenario(): CompanionAuthenticationWorkflowMatchKind {
  const observations = classifiedAuthenticationWorkflowObservations({
    workflowForms: summarizeAuthenticationWorkflowForms(),
    authenticatorSetupHint: false,
    backupCodesHint: false,
  }).map(({ facts }) => facts)
  return companion_authentication_workflow_match_kind(
    classify_companion_authentication_workflow_facts({ observations }),
  )
}

test.each([
  ['plain login', () => render(PlainLogin)],
  ['TOTP login', () => render(TotpLogin)],
  ['detected login', () => render(DetectionLogin)],
  ['OTP verification', () => render(DetectionOtp)],
  ['signup', () => render(DetectionSignup)],
  ['password change', () => render(DetectionPasswordChange)],
] as const)(
  'real mock %s markup satisfies the WASM workflow contract',
  (_, renderScenario) => {
    renderScenario()
    expect(classifyRenderedScenario()).toBe(
      CompanionAuthenticationWorkflowMatchKind.Matched,
    )
  },
)

test.each([
  ['get', '/auth/login', CompanionAuthenticationWorkflowMatchKind.NoMatch],
  ['post', '/plain/login', CompanionAuthenticationWorkflowMatchKind.NoMatch],
  [
    'post',
    'https://external-provider.example/auth/login',
    CompanionAuthenticationWorkflowMatchKind.Rejected,
  ],
] as const)(
  'rejects unsafe mock submission %s %s',
  (method, action, expected) => {
    const { container } = render(PlainLogin)
    const form = container.querySelector('form')
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('plain login fixture must render its form')
    }
    form.setAttribute('method', method)
    form.setAttribute('action', action)
    expect(classifyRenderedScenario()).toBe(expected)
  },
)
