import { expect, test } from '@playwright/test'
import {
  getServiceWorker,
  launchExtensionContext,
} from './helpers/extension-smoke-runtime'
import { installForcePinDeviceProtection } from './helpers/pin-device'
import { MOCK_AUTH_DEFAULT_PIN } from './mock-auth'

// The toolbar button opens this page as the side panel. Playwright cannot
// reach a real side panel target, so the page runs in a tab here at the
// panel's width; the ceremony and its Rust/WASM calls are the real ones.
test('sets up, locks and unlocks a PIN key in place in the side panel', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const context = await launchExtensionContext(
    testInfo.outputPath('chromium-profile-side-panel'),
  )
  await context.addInitScript(installForcePinDeviceProtection)

  try {
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host
    const panel = await context.newPage()
    await panel.setViewportSize({ width: 360, height: 720 })
    await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`)

    const state = panel.getByTestId('side-panel-state')
    await expect(state).toHaveText('Not set up')
    // Setup offers saved passkeys in its field; creating one is a choice.
    await expect(
      panel.getByTestId('device-protection-passkey-field'),
    ).toBeVisible()
    await panel.getByTestId('device-protection-create-new-choice').click()
    await panel.getByTestId('device-protection-setup-btn').click()
    // This profile has no passkeys, so the same ceremony offers the PIN.
    await expect(panel.getByTestId('device-protection-error')).toHaveText(
      "Passkeys are unavailable in this browser profile. Use a local PIN or passphrase to protect this browser's key.",
    )
    await panel
      .getByTestId('device-protection-pin-input')
      .fill(MOCK_AUTH_DEFAULT_PIN)
    await panel
      .getByTestId('device-protection-pin-confirm')
      .fill(MOCK_AUTH_DEFAULT_PIN)
    await panel.getByTestId('device-protection-pin-setup-btn').click()
    await expect(state).toHaveText('Unlocked')

    await panel.getByTestId('side-panel-lock').click()
    await expect(state).toHaveText('Locked')
    await expect(panel.getByTestId('side-panel-lock')).toHaveCount(0)
    const pin = panel.getByTestId('device-protection-pin-unlock-input')
    await expect(pin).toBeFocused()

    await pin.fill('000000-wrong')
    await pin.press('Enter')
    await expect(panel.getByTestId('device-protection-error')).toHaveText(
      'The PIN or passphrase did not unlock this browser. Check it and try again.',
    )
    await expect(pin).toHaveAttribute('aria-invalid', 'true')
    // The PIN lives only for the try that used it.
    await expect(pin).toHaveValue('')
    await expect(pin).toBeFocused()

    await pin.fill(MOCK_AUTH_DEFAULT_PIN)
    await pin.press('Enter')
    await expect(state).toHaveText('Unlocked')
    await expect(panel.getByTestId('side-panel-lock')).toBeVisible()
    expect(
      await panel.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360)
  } finally {
    await context.close()
  }
})

/** A browser that holds no Nook passkey: autofill suggests nothing and
 * waits until it is stopped, and every picker closes without one. Each
 * request is recorded on the page root, so an immediate (uiMode) request,
 * which quits Chromium browsers on extension pages, would show up. */
function installPasskeyLookupRefused(): void {
  if (globalThis.location?.protocol !== 'chrome-extension:') return
  const prompts: string[] = []
  const record = (prompt: string): void => {
    prompts.push(prompt)
    document.documentElement.dataset.nookPasskeyPrompts = prompts.join(' ')
  }
  Object.defineProperty(navigator.credentials, 'get', {
    configurable: true,
    value: async (options: CredentialRequestOptions) => {
      const immediate: unknown = Reflect.get(options, 'uiMode')
      const mediation: unknown = Reflect.get(options, 'mediation')
      if (typeof immediate === 'string') record(`uiMode-${immediate}`)
      if (mediation !== 'conditional') {
        record('picker')
        throw new DOMException(
          'No passkey for this request.',
          'NotAllowedError',
        )
      }
      record('autofill')
      const signal: unknown = Reflect.get(options, 'signal')
      return new Promise((...[, reject]) => {
        if (!(signal instanceof AbortSignal)) return
        signal.addEventListener('abort', () => {
          record('stopped')
          reject(new DOMException('Stopped.', 'AbortError'))
        })
      })
    },
  })
}

test('a passkey lookup without result offers creating one or looking elsewhere', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const context = await launchExtensionContext(
    testInfo.outputPath('chromium-profile-side-panel-not-found'),
  )
  await context.addInitScript(installPasskeyLookupRefused)

  try {
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host
    const panel = await context.newPage()
    await panel.setViewportSize({ width: 360, height: 720 })
    await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`)
    const prompts = panel.locator('html')

    // First run: the field offers saved passkeys as autofill, with no
    // dialog, next to creating a new one.
    const field = panel.getByTestId('device-protection-passkey-field')
    await expect(field).toHaveAttribute('autocomplete', 'username webauthn')
    await expect(field).toBeFocused()
    await expect(prompts).toHaveAttribute(
      'data-nook-passkey-prompts',
      'autofill',
    )
    await expect(
      panel.getByTestId('device-protection-create-new-choice'),
    ).toHaveText('Create a new passkey')

    // The field is a picker for the browser's saved-passkey list, not a
    // search: typing changes nothing, and opening it with nothing to list
    // says what that means.
    await field.press('a')
    await expect(field).toHaveValue('')
    await field.click()
    await expect(
      panel.getByTestId('device-protection-passkey-empty'),
    ).toHaveText(
      'No list showed up? This browser has no Nook passkey saved yet: create one below.',
    )

    // A phone or security key needs the picker, which stops autofill first.
    await panel.getByTestId('device-protection-use-existing-choice').click()
    const title = panel.getByTestId('device-protection-title')
    await expect(title).toHaveText("Didn't find your passkey?")
    await expect(prompts).toHaveAttribute(
      'data-nook-passkey-prompts',
      'autofill stopped picker',
    )
    const create = panel.getByTestId('device-protection-create-new-choice')
    await expect(create).toHaveText('Create passkey')
    await expect(create).toBeFocused()
    await expect(panel.getByTestId('device-protection-error')).toHaveCount(0)

    // Looking again opens the same picker; closing it stays and says so.
    await panel.getByTestId('device-protection-use-existing-choice').click()
    await expect(panel.getByTestId('device-protection-error')).toHaveText(
      "Your passkey wasn't used: the prompt was closed, timed out, or couldn't find it. Try again.",
    )
    await expect(prompts).toHaveAttribute(
      'data-nook-passkey-prompts',
      'autofill stopped picker picker',
    )
    await expect(title).toHaveText("Didn't find your passkey?")

    // Creating stays an explicit step with its own options.
    await create.click()
    await expect(title).toHaveText('Create a passkey')
    await expect(panel.getByTestId('device-protection-setup-btn')).toHaveText(
      'Create passkey',
    )
  } finally {
    await context.close()
  }
})
