/** The website passkey card's strings in the shared locale catalog. */
export type PasskeyLocaleMessages = {
  prompt_label: string
  label: string
  close: string
  save_title: string
  use_title: string
  account_label: string
  save_to_label: string
  choose_account: string
  save_action: string
  saving: string
  signing_in: string
  saved_title: string
  saved_detail: string
  save_failed: string
  use_failed: string
  no_match: string
  locked: string
  unlock_action: string
  unlock_waiting: string
  continue_action: string
  checking: string
  no_vault: string
  check_failed: string
  use_another: string
  use_browser: string
}

type PasskeyLocaleMessageKey = keyof PasskeyLocaleMessages

type PasskeyLocaleSection = {
  message(key: PasskeyLocaleMessageKey, label: string): string
}

type ChromeLocaleMessage = { message: string }

/** Chrome message names the passkey card reads, and their catalog keys. */
const PASSKEY_CARD_MESSAGES: Readonly<Record<string, PasskeyLocaleMessageKey>> =
  {
    passkeyPromptLabel: 'prompt_label',
    passkeyLabel: 'label',
    passkeyClose: 'close',
    passkeySaveTitle: 'save_title',
    passkeyUseTitle: 'use_title',
    passkeyAccountLabel: 'account_label',
    passkeySaveToLabel: 'save_to_label',
    passkeyChooseAccount: 'choose_account',
    passkeySaveAction: 'save_action',
    passkeySaving: 'saving',
    passkeySigningIn: 'signing_in',
    passkeySavedTitle: 'saved_title',
    passkeySavedDetail: 'saved_detail',
    passkeySaveFailed: 'save_failed',
    passkeyUseFailed: 'use_failed',
    passkeyNoMatch: 'no_match',
    passkeyLocked: 'locked',
    passkeyUnlockAction: 'unlock_action',
    passkeyUnlockWaiting: 'unlock_waiting',
    passkeyContinueAction: 'continue_action',
    passkeyChecking: 'checking',
    passkeyNoVault: 'no_vault',
    passkeyCheckFailed: 'check_failed',
    passkeyUseAnother: 'use_another',
    passkeyUseBrowser: 'use_browser',
  }

/** The passkey card's Chrome messages for one locale. */
export function passkeyCardMessages(
  section: PasskeyLocaleSection,
  locale: string,
): Record<string, ChromeLocaleMessage> {
  return Object.fromEntries(
    Object.entries(PASSKEY_CARD_MESSAGES).map(([name, key]) => [
      name,
      { message: section.message(key, locale) },
    ]),
  )
}
