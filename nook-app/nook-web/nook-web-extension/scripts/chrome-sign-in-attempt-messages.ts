import type { SignInAttemptMessageKey } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../src/lib/browser-message-keys'

/** Shared `extension.widget` catalog fields that carry sign-in attempt copy. */
export type SignInAttemptWidgetCatalog = {
  sign_in_signing_in: string
  sign_in_signing_in_description: string
  sign_in_signed_in: string
  sign_in_signed_in_description: string
  sign_in_failed: string
  sign_in_failed_description: string
  sign_in_reason_wrong_credentials: string
  sign_in_reason_account_locked: string
  sign_in_reason_rate_limited: string
  sign_in_reason_challenge_required: string
  sign_in_reason_unknown: string
  sign_in_site_message_label: string
  sign_in_action_unavailable: string
  sign_in_challenge: string
  sign_in_challenge_one_time_code_description: string
  sign_in_challenge_verification_description: string
  sign_in_timed_out: string
  sign_in_timed_out_description: string
  sign_in_try_again: string
  sign_in_choose_another_login: string
  sign_in_reset_password: string
  sign_in_dismiss: string
}

type SignInAttemptWidgetMessageKey = keyof SignInAttemptWidgetCatalog
type SignInAttemptCatalogLookup = (key: SignInAttemptWidgetMessageKey) => string
type SignInAttemptChromeMessage = { message: string }
type SignInAttemptChromeMessageMap = Record<string, SignInAttemptChromeMessage>
/** Rust-selected sign-in keys this projection owns; the rest have their own entries. */
type SignInAttemptRustChromeKey = Extract<
  SignInAttemptMessageKey,
  `widgetSignIn${string}`
>
type SignInAttemptChromeKey =
  | SignInAttemptRustChromeKey
  | typeof BROWSER_MESSAGE_KEYS.WidgetSignInSiteMessageLabel
  | typeof BROWSER_MESSAGE_KEYS.WidgetSignInActionUnavailable
/** Compile-time exhaustive: a Rust key without an entry fails the build. */
type SignInAttemptChromeEntries = {
  readonly [Key in SignInAttemptChromeKey]: SignInAttemptWidgetMessageKey
}
/** Every Rust-selected key must also be a registered chrome message key. */
type SignInAttemptKeysRegistered = [SignInAttemptMessageKey] extends [
  BrowserMessageKey,
]
  ? true
  : false

/** Projects the Rust-selected sign-in attempt chrome keys onto the shared catalog. */
export class SignInAttemptChromeMessages {
  static readonly KEYS_REGISTERED: SignInAttemptKeysRegistered = true
  static readonly ENTRIES: SignInAttemptChromeEntries = {
    widgetSignInSigningIn: 'sign_in_signing_in',
    widgetSignInSigningInDescription: 'sign_in_signing_in_description',
    widgetSignInSignedIn: 'sign_in_signed_in',
    widgetSignInSignedInDescription: 'sign_in_signed_in_description',
    widgetSignInFailed: 'sign_in_failed',
    widgetSignInFailedDescription: 'sign_in_failed_description',
    widgetSignInReasonWrongCredentials: 'sign_in_reason_wrong_credentials',
    widgetSignInReasonAccountLocked: 'sign_in_reason_account_locked',
    widgetSignInReasonRateLimited: 'sign_in_reason_rate_limited',
    widgetSignInReasonChallengeRequired: 'sign_in_reason_challenge_required',
    widgetSignInReasonUnknown: 'sign_in_reason_unknown',
    widgetSignInSiteMessageLabel: 'sign_in_site_message_label',
    widgetSignInActionUnavailable: 'sign_in_action_unavailable',
    widgetSignInChallenge: 'sign_in_challenge',
    widgetSignInChallengeOneTimeCodeDescription:
      'sign_in_challenge_one_time_code_description',
    widgetSignInChallengeVerificationDescription:
      'sign_in_challenge_verification_description',
    widgetSignInTimedOut: 'sign_in_timed_out',
    widgetSignInTimedOutDescription: 'sign_in_timed_out_description',
    widgetSignInTryAgain: 'sign_in_try_again',
    widgetSignInChooseAnotherLogin: 'sign_in_choose_another_login',
    widgetSignInResetPassword: 'sign_in_reset_password',
    widgetSignInDismiss: 'sign_in_dismiss',
  }

  constructor(private readonly lookup: SignInAttemptCatalogLookup) {}

  messages(): SignInAttemptChromeMessageMap {
    const messages: SignInAttemptChromeMessageMap = {}
    for (const [chromeKey, catalogKey] of Object.entries(
      SignInAttemptChromeMessages.ENTRIES,
    )) {
      messages[chromeKey] = { message: this.lookup(catalogKey) }
    }
    return messages
  }
}
