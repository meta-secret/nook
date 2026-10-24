/** The personal picker document's strings in the shared locale catalog. */
export type PersonalPickerLocaleMessages = {
  title: string
  description: string
  unnamed: string
  loading: string
  no_results: string
  failed: string
}

type PersonalPickerLocaleMessageKey = keyof PersonalPickerLocaleMessages

type PersonalPickerLocaleSection = {
  message(key: PersonalPickerLocaleMessageKey, label: string): string
}

type ChromeLocaleMessage = { message: string }

type PersonalPickerChromeMessageRequest = {
  readonly section: PersonalPickerLocaleSection
  readonly locale: string
}

/**
 * Chrome message names the personal picker reads, and their catalog keys.
 * The picker reads them through chrome.i18n, so its page loads no WASM.
 */
export class PersonalPickerChromeMessages {
  private static readonly NAMES: Readonly<
    Record<string, PersonalPickerLocaleMessageKey>
  > = {
    personalPickerTitle: 'title',
    personalPickerDescription: 'description',
    personalPickerUnnamed: 'unnamed',
    personalPickerLoading: 'loading',
    personalPickerNoResults: 'no_results',
    personalPickerFailed: 'failed',
  }

  /** The personal picker's Chrome messages for one locale. */
  static messages(
    request: PersonalPickerChromeMessageRequest,
  ): Record<string, ChromeLocaleMessage> {
    return Object.fromEntries(
      Object.entries(PersonalPickerChromeMessages.NAMES).map(([name, key]) => [
        name,
        { message: request.section.message(key, request.locale) },
      ]),
    )
  }
}
