import type { LoginSubmissionCapture } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  WebsiteLoginSaveCommitMessage as WebsiteLoginSaveCommitMessageSchema,
  WebsiteLoginSaveDismissMessage as WebsiteLoginSaveDismissMessageSchema,
  WebsiteLoginSaveOfferMessage as WebsiteLoginSaveOfferMessageSchema,
  WebsiteLoginSavePendingMessage as WebsiteLoginSavePendingMessageSchema,
} from '../src/lib/login-save-messages'

class LoginSaveMessageFixture {
  readonly capture: LoginSubmissionCapture = {
    submitted_at: 1000, submitted_url: 'https://login.example.com/login', controls: ['Sign in'], explicit_candidate: 'Present',
    fields: [
      {input_type: 'text', disabled: false, read_only: false, autocomplete_tokens: ['username'], identity_text: 'User', login_context: false, password_history: 'Unobserved'},
      {input_type: 'password', disabled: false, read_only: false, autocomplete_tokens: ['current-password'], identity_text: 'Password', login_context: false, password_history: 'PreviouslyPassword'},
    ],
    intent: {event: 'FormSubmit', trust: 'Trusted', target: {kind: 'CredentialScope'}, control_label: 'Sign in', context: {
      fields: {usernameFieldCount: 0, currentPasswordFieldCount: 0, newPasswordFieldCount: 0, genericPasswordFieldCount: 0, oneTimeCodeFieldCount: 0, actionablePasswordFieldCount: 0, readonlyPasswordFieldCount: 0},
      ceremony: {oneTimeCodeProgression: 'advance-control-required', oneTimeCodeHandlerSignal: '', authenticationContext: {authenticationUsername: 'absent', sourceOrigin: 'https://login.example.com', formIdentity: 'login', destinationIdentity: '/login'}, manualCheckpoint: 'absent', advanceControl: 'absent'},
      authenticator: {authenticatorSetup: 'absent', backupCodesCopy: '', passkeyControl: 'absent', passkeyAccountAvailability: 'unavailable', matchingPasskeyAccountCount: 0, detailedPasskeyControl: {kind: 'absent'}},
      credentialSubmission: {kind: 'absent'}, detailedAdvanceControl: {kind: 'absent'},
    }},
  }
}

describe('website login save runtime messages', () => {
  test('accepts typed save offer, pending, commit, and dismiss messages', () => {
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveOfferMessageSchema.decode({
            type: 'nook:website-login-save-offer',
            payload: {
              origin: 'https://login.example.com',
              username: 'alice@example.com',
              password: 'secret',
              capture: new LoginSaveMessageFixture().capture,
              capturedValues: ['alice@example.com', 'secret'],
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSavePendingMessageSchema.decode({
            type: 'nook:website-login-save-pending',
            payload: { origin: 'https://login.example.com' },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveCommitMessageSchema.decode({
            type: 'nook:website-login-save-commit',
            payload: {
              origin: 'https://login.example.com',
              offerId: 'offer_1',
              evidence: {
                kind: 'ExplicitAuthentication',
                observation: {
                navigatedAwayFromAuthPath: true,
                authFieldsPresent: false,
                successMarkerPresent: true,
                errorMarkerPresent: false,
                sameDocumentMutation: false,
                inIframe: false,
                elapsedMs: 400,
                },
              },
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveDismissMessageSchema.decode({
            type: 'nook:website-login-save-dismiss',
            payload: {
              origin: 'https://login.example.com',
              offerId: 'offer_1',
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
  })

  test('rejects malformed save messages', () => {
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveOfferMessageSchema.decode({
            type: 'nook:website-login-save-offer',
            payload: {
              origin: 'https://login.example.com',
              username: '',
              password: 'secret',
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginSaveCommitMessageSchema.decode({
            type: 'nook:website-login-save-commit',
            payload: {
              origin: 'https://login.example.com',
              offerId: 'offer_1',
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
  })
})
