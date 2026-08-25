import { describe, expect, test } from 'bun:test'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  AUTHENTICATION_VIEWPORT_EVENTS,
  authenticationEnrollmentObservation,
  authenticationPageObservation,
} from '../src/content/autofill/authentication-observation'

describe('authentication workflow observation', () => {
  test('rescans when a custom role button becomes focusable', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('tabindex')
  })

  test('rescans when a form action gains or loses login context', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('action')
  })

  test('rescans when an authentication dialog opens or closes', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('open')
  })

  test('rescans when an authentication field gains or loses readonly', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('readonly')
  })

  test('rescans when field identity evidence changes', () => {
    for (const attribute of ['placeholder', 'data-qa', 'data-testid', 'for']) {
      expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain(attribute)
    }
  })

  test('rescans when a manual checkpoint marker changes', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain(
      'data-nook-manual-checkpoint',
    )
  })

  test('reports manual checkpoints alongside direct enrollment evidence', () => {
    const observation = authenticationEnrollmentObservation({
      authenticatorSetupPresent: true,
      backupCodesPresent: false,
      manualCheckpointPresent: true,
    })

    expect(observation.authenticator.authenticatorSetup).toBe('present')
    expect(observation.ceremony.manualCheckpoint).toBe('present')
  })

  test('reports page checkpoints alongside regular form observations', () => {
    const observation = authenticationPageObservation({
      summary: {
        usernameFieldCount: 1,
        currentPasswordFieldCount: 0,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        oneTimeCodeFieldCount: 0,
        oneTimeCodeAutoSubmitObserved: false,
        manualCheckpointPresent: false,
        authenticationAdvanceControlPresent: true,
        passkeyControlPresent: false,
      },
      authenticatorSetupPresent: false,
      backupCodesPresent: true,
      manualCheckpointPresent: true,
    })

    expect(observation.authenticator.backupCodes).toBe('present')
    expect(observation.ceremony.manualCheckpoint).toBe('present')
  })

  test('rescans when an explicit passkey-control marker changes', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain(
      'data-nook-passkey-control',
    )
  })

  test('rescans when responsive CSS can change control visibility', () => {
    expect(AUTHENTICATION_VIEWPORT_EVENTS).toContain('resize')
  })
})
