import { describe, expect, test } from 'bun:test'
import { authenticationEnrollmentObservationFacts } from '../src/content/autofill/authentication-enrollment-observation'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  AUTHENTICATION_VIEWPORT_EVENTS,
} from '../src/content/autofill/authentication-surface-observation'

describe('authentication observation contract', () => {
  test('rescans when page controls or identity evidence change', () => {
    for (const attribute of [
      'action',
      'data-nook-manual-checkpoint',
      'data-nook-passkey-control',
      'open',
      'placeholder',
      'readonly',
      'tabindex',
    ]) {
      expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain(attribute)
    }
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

  test('rechecks responsive visibility after viewport changes', () => {
    expect(AUTHENTICATION_VIEWPORT_EVENTS).toEqual(['resize', 'scroll'])
  })

  test('reports direct enrollment evidence without inventing form facts', () => {
    const observation = authenticationEnrollmentObservationFacts({
      authenticatorSetupPresent: true,
      backupCodesPresent: true,
      manualCheckpointPresent: false,
    })

    expect(observation.fields).toEqual({
      usernameFieldCount: 0,
      currentPasswordFieldCount: 0,
      newPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      oneTimeCodeFieldCount: 0,
    })
    expect(observation.authenticator).toMatchObject({
      authenticatorSetup: 'present',
      backupCodes: 'present',
      passkeyControl: 'absent',
      matchingPasskeyAccountCount: 0,
    })
    expect(observation.ceremony).toMatchObject({
      oneTimeCodeProgression: 'advance-control-required',
      manualCheckpoint: 'absent',
      advanceControl: 'absent',
    })
  })
})
