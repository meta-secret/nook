import type { AuthenticationPageObservationFacts } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** Fresh browser observations for a login form, before Rust admission. */
export class AuthenticationObservationFixture {
  static empty(origin: string) {
    return {
      fields: {
        usernameFieldCount: 0,
        currentPasswordFieldCount: 0,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        oneTimeCodeFieldCount: 0,
        actionablePasswordFieldCount: 0,
        readonlyPasswordFieldCount: 0,
      },
      ceremony: {
        oneTimeCodeProgression: 'advance-control-required',
        oneTimeCodeHandlerSignal: '',
        authenticationContext: {
          authenticationUsername: 'absent',
          sourceOrigin: origin,
          formIdentity: 'login',
          destinationIdentity: '/login',
        },
        manualCheckpoint: 'absent',
        advanceControl: 'absent',
      },
      authenticator: {
        authenticatorSetup: 'absent',
        backupCodesCopy: '',
        passkeyControl: 'absent',
        passkeyAccountAvailability: 'unavailable',
        matchingPasskeyAccountCount: 0,
        detailedPasskeyControl: { kind: 'absent' },
      },
      credentialSubmission: { kind: 'absent' },
      detailedAdvanceControl: { kind: 'absent' },
    } satisfies AuthenticationPageObservationFacts
  }

  static login(origin: string) {
    const facts = AuthenticationObservationFixture.empty(origin)
    return {
      ...facts,
      fields: {
        ...facts.fields,
        usernameFieldCount: 1,
        currentPasswordFieldCount: 1,
        actionablePasswordFieldCount: 1,
      },
      ceremony: {
        ...facts.ceremony,
        authenticationContext: {
          ...facts.ceremony.authenticationContext,
          authenticationUsername: 'explicit',
        },
      },
    } satisfies AuthenticationPageObservationFacts
  }
}
