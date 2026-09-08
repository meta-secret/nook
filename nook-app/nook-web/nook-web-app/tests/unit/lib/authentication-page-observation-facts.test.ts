import { describe, expect, test } from 'vitest'
import { assembleAuthenticationPageObservationFacts } from '../../../../nook-web-shared/src/extension/authentication-page-observation-facts'

describe('authentication page observation facts assembly', () => {
  test('emits a complete explicit absent disclosure-control state', () => {
    const facts = assembleAuthenticationPageObservationFacts({
      summary: {
        usernameFieldCount: 1,
        currentPasswordFieldCount: 1,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        oneTimeCodeFieldCount: 0,
        manualCheckpointPresent: false,
      },
      actionablePasswordFieldCount: 1,
      readonlyPasswordFieldCount: 0,
      oneTimeCodeHandlerSignals: [],
      authenticationUsername: 'explicit',
      sourceOrigin: 'https://login.example.test',
      formIdentity: 'login',
      destinationIdentity: '/login',
      implicitSubmissionMethod: 'absent',
      implicitSubmissionAvailable: false,
      authenticatorSetupHint: false,
      backupCodesCopy: '',
      passkeyControlPresent: false,
      detailedPasskeyControl: { kind: 'absent' },
      credentialSubmission: { kind: 'absent' },
      detailedAdvanceControl: { kind: 'absent' },
    })

    expect(facts).toMatchObject({
      fields: {
        usernameFieldCount: 1,
        currentPasswordFieldCount: 1,
        actionablePasswordFieldCount: 1,
        readonlyPasswordFieldCount: 0,
      },
      ceremony: {
        authenticationContext: {
          authenticationUsername: 'explicit',
          sourceOrigin: 'https://login.example.test',
          formIdentity: 'login',
          destinationIdentity: '/login',
        },
        implicitSubmissionMethod: 'absent',
        advanceControl: 'absent',
      },
      authenticator: {
        detailedPasskeyControl: { kind: 'absent' },
      },
      credentialDisclosureControl: { kind: 'absent' },
      credentialSubmission: { kind: 'absent' },
      detailedAdvanceControl: { kind: 'absent' },
    })
  })
})
