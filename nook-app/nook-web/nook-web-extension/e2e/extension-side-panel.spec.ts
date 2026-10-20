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
    // Setup starts with an existing passkey; creating one is a choice.
    await expect(
      panel.getByTestId('device-protection-use-existing-choice'),
    ).toHaveText('Use my passkey')
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

/** A browser that holds no Nook passkey: every lookup is refused, as an
 * empty immediate request or a closed picker is. Each request's prompt mode
 * is recorded on the page root. */
function installPasskeyLookupRefused(): void {
  if (globalThis.location?.protocol !== 'chrome-extension:') return
  const prompts: string[] = []
  Object.defineProperty(navigator.credentials, 'get', {
    configurable: true,
    value: async (options: object) => {
      const mode: unknown = Reflect.get(options, 'uiMode')
      prompts.push(typeof mode === 'string' ? mode : 'picker')
      document.documentElement.dataset.nookPasskeyPrompts = prompts.join(' ')
      throw new DOMException('No passkey for this request.', 'NotAllowedError')
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

    // First run: an existing passkey and a new one, side by side.
    await expect(
      panel.getByTestId('device-protection-create-new-choice'),
    ).toHaveText('Create a new passkey')
    await panel.getByTestId('device-protection-use-existing-choice').click()

    // The browser answers at once; with nothing to offer, the card says so
    // instead of leaving the person in a phone or security-key dialog.
    const title = panel.getByTestId('device-protection-title')
    await expect(title).toHaveText("Didn't find your passkey?")
    await expect(prompts).toHaveAttribute(
      'data-nook-passkey-prompts',
      'immediate',
    )
    const create = panel.getByTestId('device-protection-create-new-choice')
    await expect(create).toHaveText('Create passkey')
    await expect(create).toBeFocused()
    await expect(panel.getByTestId('device-protection-error')).toHaveCount(0)

    // Looking elsewhere opens the browser's full picker; closing it stays.
    await panel.getByTestId('device-protection-use-existing-choice').click()
    await expect(panel.getByTestId('device-protection-error')).toHaveText(
      "Your passkey wasn't used: the prompt was closed, timed out, or couldn't find it. Try again.",
    )
    await expect(prompts).toHaveAttribute(
      'data-nook-passkey-prompts',
      'immediate picker',
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
