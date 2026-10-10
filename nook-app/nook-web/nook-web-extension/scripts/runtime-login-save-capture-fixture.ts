import type { authenticationRuntimeTransport } from '../src/content/autofill/runtime-message-adapter'

export class RuntimeLoginSaveCaptureFixture {
  readonly capture: Parameters<
    typeof authenticationRuntimeTransport.sendLoginSaveOfferRuntimeMessage
  >[0]['payload']['capture'] = {
    submitted_at: 1000,
    submitted_url: 'https://example.test/login',
    controls: ['Sign in'],
    explicit_candidate: 'Present',
    fields: [
      {
        input_type: 'text',
        disabled: false,
        read_only: false,
        autocomplete_tokens: ['username'],
        identity_text: 'User',
        login_context: false,
        password_history: 'Unobserved',
      },
      {
        input_type: 'password',
        disabled: false,
        read_only: false,
        autocomplete_tokens: ['current-password'],
        identity_text: 'Password',
        login_context: false,
        password_history: 'PreviouslyPassword',
      },
    ],
    intent: {
      event: 'FormSubmit',
      trust: 'Trusted',
      target: { kind: 'CredentialScope' },
      control_label: 'Sign in',
      context: {
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
            sourceOrigin: 'https://example.test',
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
      },
    },
  }
}
