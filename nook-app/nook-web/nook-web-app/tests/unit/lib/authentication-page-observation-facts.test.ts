import { describe, expect, test } from 'vitest'
import {
  AuthenticationPageObservationFactsAssembler,
  type AuthenticationPageObservationFactsAssemblyRequest,
} from '../../../../nook-web-shared/src/extension/authentication-page-observation-facts'

describe('authentication page observation facts assembly', () => {
  test('emits a complete explicit absent disclosure-control state', () => {
    const request: AuthenticationPageObservationFactsAssemblyRequest = {
      summary: {
        usernameFieldCount: 1,
        currentPasswordFieldCount: 1,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        oneTimeCodeFieldCount: 0,
      },
      actionablePasswordFieldCount: 1,
      readonlyPasswordFieldCount: 0,
      oneTimeCodeHandlerSignals: [],
      authenticationUsername: 'explicit',
      sourceOrigin: 'https://login.example.test',
      formIdentity: 'login',
      destinationIdentity: '/login',
      manualCheckpoint: 'present',
      implicitSubmissionMethod: 'absent',
      advanceControl: 'implicit-submission',
      authenticatorSetup: 'present',
      backupCodesCopy: '',
      passkeyControl: 'present',
      detailedPasskeyControl: { kind: 'absent' },
      credentialSubmission: { kind: 'absent' },
      detailedAdvanceControl: { kind: 'absent' },
    }
    const facts = new AuthenticationPageObservationFactsAssembler(
      request,
    ).assemble()

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
        manualCheckpoint: 'present',
        implicitSubmissionMethod: 'absent',
        advanceControl: 'implicit-submission',
      },
      authenticator: {
        authenticatorSetup: 'present',
        passkeyControl: 'present',
        detailedPasskeyControl: { kind: 'absent' },
      },
      credentialDisclosureControl: { kind: 'absent' },
      credentialSubmission: { kind: 'absent' },
      detailedAdvanceControl: { kind: 'absent' },
    })
  })
})
