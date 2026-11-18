import { AuthenticationObservationFixture } from './authentication-observation-fixture'
import type { LoginSubmissionCapture } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export class RuntimeLoginSaveCaptureFixture {
  static capture(origin: string) {
    return {
      submitted_at: 1000,
      submitted_url: `${origin}/login`,
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
      intent: RuntimeLoginSaveCaptureFixture.intent(origin),
    } satisfies LoginSubmissionCapture
  }

  static intent(origin: string) {
    return {
      event: 'FormSubmit',
      trust: 'Trusted',
      target: { kind: 'CredentialScope' },
      control_label: 'Sign in',
      context: AuthenticationObservationFixture.empty(origin),
    } satisfies LoginSubmissionCapture['intent']
  }
}
