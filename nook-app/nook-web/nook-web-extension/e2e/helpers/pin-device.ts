import { expect, type Page } from '@playwright/test'
import { MOCK_AUTH_DEFAULT_PIN } from '../mock-auth'

/** Force the extension popup into the PIN device-protection path. */
export function installForcePinDeviceProtection(): void {
  Object.defineProperty(globalThis, 'PublicKeyCredential', {
    configurable: true,
    get() {
      return undefined
    },
  })
}

export async function ensurePinProtectedPopup(
  popupPage: Page,
  pin = MOCK_AUTH_DEFAULT_PIN,
): Promise<void> {
  const companionHome = popupPage.getByTestId('extension-companion-home')
  if (await companionHome.isVisible().catch(() => false)) {
    return
  }

  const pinUnlock = popupPage.getByTestId('device-protection-pin-unlock-btn')
  if (await pinUnlock.isVisible().catch(() => false)) {
    await popupPage.getByTestId('device-protection-pin-unlock-input').fill(pin)
    await pinUnlock.click()
    await expect(companionHome).toBeVisible({ timeout: 45_000 })
    return
  }

  await expect(popupPage.getByTestId('extension-device-setup')).toBeVisible({
    timeout: 45_000,
  })
  await popupPage.getByTestId('device-protection-setup-btn').click()
  await expect(
    popupPage.getByTestId('device-protection-pin-input'),
  ).toBeVisible({ timeout: 45_000 })
  await popupPage.getByTestId('device-protection-pin-input').fill(pin)
  await popupPage.getByTestId('device-protection-pin-confirm').fill(pin)
  await popupPage.getByTestId('device-protection-pin-setup-btn').click()
  await expect(companionHome).toBeVisible({ timeout: 45_000 })
}
