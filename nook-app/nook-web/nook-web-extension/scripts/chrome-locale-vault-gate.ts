/** The widget's connect-first and unlock-first strings in the shared catalog. */
export type VaultGateLocaleMessages = {
  connect_first_title: string
  connect_first_description: string
  connect_first_action: string
  connect_first_opened: string
  connect_first_failed: string
  unlock_first_title: string
  gate_dismiss: string
}

type VaultGateLocaleMessageKey = keyof VaultGateLocaleMessages

type VaultGateLocaleSection = {
  message(key: VaultGateLocaleMessageKey, label: string): string
}

type ChromeLocaleMessage = { message: string }

type VaultGateChromeMessageRequest = {
  readonly section: VaultGateLocaleSection
  readonly locale: string
}

/** Chrome message names of the widget's vault gate, and their catalog keys. */
export class VaultGateChromeMessages {
  private static readonly NAMES: Readonly<
    Record<string, VaultGateLocaleMessageKey>
  > = {
    widgetConnectFirstTitle: 'connect_first_title',
    widgetConnectFirstDescription: 'connect_first_description',
    widgetConnectFirstAction: 'connect_first_action',
    widgetConnectFirstOpened: 'connect_first_opened',
    widgetConnectFirstFailed: 'connect_first_failed',
    widgetUnlockFirstTitle: 'unlock_first_title',
    widgetGateDismiss: 'gate_dismiss',
  }

  /** The vault gate's Chrome messages for one locale. */
  static messages(
    request: VaultGateChromeMessageRequest,
  ): Record<string, ChromeLocaleMessage> {
    return Object.fromEntries(
      Object.entries(VaultGateChromeMessages.NAMES).map(([name, key]) => [
        name,
        { message: request.section.message(key, request.locale) },
      ]),
    )
  }
}
