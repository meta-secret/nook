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
type SignInAttemptChromeMessageEntry = {
  readonly chromeKey: BrowserMessageKey
  readonly catalogKey: SignInAttemptWidgetMessageKey
}
type SignInAttemptChromeMessageEntries =
  readonly SignInAttemptChromeMessageEntry[]
type SignInAttemptChromeMessageMap = Record<string, SignInAttemptChromeMessage>

/** Projects the Rust-selected sign-in attempt chrome keys onto the shared catalog. */
export class SignInAttemptChromeMessages {
  static readonly ENTRIES: SignInAttemptChromeMessageEntries = [
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInSigningIn,
      catalogKey: 'sign_in_signing_in',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInSigningInDescription,
      catalogKey: 'sign_in_signing_in_description',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInSignedIn,
      catalogKey: 'sign_in_signed_in',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInSignedInDescription,
      catalogKey: 'sign_in_signed_in_description',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInFailed,
      catalogKey: 'sign_in_failed',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInFailedDescription,
      catalogKey: 'sign_in_failed_description',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInReasonWrongCredentials,
      catalogKey: 'sign_in_reason_wrong_credentials',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInReasonAccountLocked,
      catalogKey: 'sign_in_reason_account_locked',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInReasonRateLimited,
      catalogKey: 'sign_in_reason_rate_limited',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInReasonChallengeRequired,
      catalogKey: 'sign_in_reason_challenge_required',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInReasonUnknown,
      catalogKey: 'sign_in_reason_unknown',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInSiteMessageLabel,
      catalogKey: 'sign_in_site_message_label',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInChallenge,
      catalogKey: 'sign_in_challenge',
    },
    {
      chromeKey:
        BROWSER_MESSAGE_KEYS.WidgetSignInChallengeOneTimeCodeDescription,
      catalogKey: 'sign_in_challenge_one_time_code_description',
    },
    {
      chromeKey:
        BROWSER_MESSAGE_KEYS.WidgetSignInChallengeVerificationDescription,
      catalogKey: 'sign_in_challenge_verification_description',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInTimedOut,
      catalogKey: 'sign_in_timed_out',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInTimedOutDescription,
      catalogKey: 'sign_in_timed_out_description',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInTryAgain,
      catalogKey: 'sign_in_try_again',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInChooseAnotherLogin,
      catalogKey: 'sign_in_choose_another_login',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInResetPassword,
      catalogKey: 'sign_in_reset_password',
    },
    {
      chromeKey: BROWSER_MESSAGE_KEYS.WidgetSignInDismiss,
      catalogKey: 'sign_in_dismiss',
    },
  ]

  constructor(private readonly lookup: SignInAttemptCatalogLookup) {}

  messages(): SignInAttemptChromeMessageMap {
    const messages: SignInAttemptChromeMessageMap = {}
    for (const entry of SignInAttemptChromeMessages.ENTRIES) {
      messages[entry.chromeKey] = { message: this.lookup(entry.catalogKey) }
    }
    return messages
  }
}
