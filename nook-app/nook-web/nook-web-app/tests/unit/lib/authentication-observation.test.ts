import { describe, expect, test } from 'vitest'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  AUTHENTICATION_VIEWPORT_EVENTS,
  authenticationPageObservation,
} from '../../../../nook-web-extension/src/content/autofill/authentication-observation'
import type { PasswordFormSummary } from '../../../../nook-web-shared/src/extension/password-forms'

describe('authentication observation attributes', () => {
  test('rescans when an iframe source becomes a manual checkpoint', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('src')
  })

  test('rescans when scrolling can change control visibility', () => {
    expect(AUTHENTICATION_VIEWPORT_EVENTS).toContain('scroll')
  })

  test('rescans when direct one-time-code progression evidence changes', () => {
    for (const attribute of [
      'data-auto-submit',
      'data-autosubmit',
      'data-submit-on-input',
      'onchange',
      'oninput',
    ]) {
      expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain(attribute)
    }
  })

  test('does not infer auto-submit from a one-time-code field without a control', () => {
    const summary: PasswordFormSummary = {
      passwordFieldCount: 0,
      currentPasswordFieldCount: 0,
      newPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      usernameFieldCount: 0,
      oneTimeCodeFieldCount: 1,
      oneTimeCodeAutoSubmitObserved: false,
      manualCheckpointPresent: false,
      passkeyControlPresent: false,
      authenticationAdvanceControlPresent: false,
      formCount: 1,
      observedAt: 0,
    }
    const request: Parameters<typeof authenticationPageObservation>[0] = {
      summary,
      authenticatorSetupPresent: false,
      backupCodesPresent: false,
    }

    expect(authenticationPageObservation(request).ceremony).toEqual({
      oneTimeCodeProgression: 'advance-control-required',
      manualCheckpoint: 'absent',
      advanceControl: 'absent',
    })
  })

  test('reports direct one-time-code auto-submit evidence', () => {
    const summary: PasswordFormSummary = {
      passwordFieldCount: 0,
      currentPasswordFieldCount: 0,
      newPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      usernameFieldCount: 0,
      oneTimeCodeFieldCount: 1,
      oneTimeCodeAutoSubmitObserved: true,
      manualCheckpointPresent: false,
      passkeyControlPresent: false,
      authenticationAdvanceControlPresent: false,
      formCount: 1,
      observedAt: 0,
    }
    const request: Parameters<typeof authenticationPageObservation>[0] = {
      summary,
      authenticatorSetupPresent: false,
      backupCodesPresent: false,
    }

    expect(
      authenticationPageObservation(request).ceremony.oneTimeCodeProgression,
    ).toBe('auto-submit-observed')
  })
})
