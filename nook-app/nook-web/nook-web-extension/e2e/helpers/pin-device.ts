import { expect, type Page } from '@playwright/test'
import { MOCK_AUTH_DEFAULT_PIN } from '../mock-auth'

export enum PinDeviceEntrySurfaceKind {
  CompanionHome = 'companion-home',
  PinUnlock = 'pin-unlock',
  InitialSetup = 'initial-setup',
  Waiting = 'waiting',
  Ambiguous = 'ambiguous',
}

export type PinDeviceEntrySurfaceObservation = {
  readonly companionHomeVisible: boolean
  readonly pinUnlockVisible: boolean
  readonly initialSetupVisible: boolean
}

export function classifyPinDeviceEntrySurface(
  observation: PinDeviceEntrySurfaceObservation,
): PinDeviceEntrySurfaceKind {
  const visibleSurfaceCount = [
    observation.companionHomeVisible,
    observation.pinUnlockVisible,
    observation.initialSetupVisible,
  ].filter((isVisible) => isVisible).length
  if (visibleSurfaceCount === 0) return PinDeviceEntrySurfaceKind.Waiting
  if (visibleSurfaceCount > 1) return PinDeviceEntrySurfaceKind.Ambiguous
  if (observation.companionHomeVisible) {
    return PinDeviceEntrySurfaceKind.CompanionHome
  }
  if (observation.pinUnlockVisible) {
    return PinDeviceEntrySurfaceKind.PinUnlock
  }
  return PinDeviceEntrySurfaceKind.InitialSetup
}

/**
 * Force the extension popup into the PIN device-protection path.
 * Only touch chrome-extension pages — Simple Vault still needs WebAuthn APIs
 * present for boot/detection even when the vault is created from the
 * extension device key.
 */
export function installForcePinDeviceProtection(): void {
  if (globalThis.location?.protocol !== 'chrome-extension:') return
  Object.defineProperty(globalThis, 'PublicKeyCredential', {
    configurable: true,
    get() {
      return
    },
  })
}

export async function ensurePinProtectedPopup(
  popupPage: Page,
  pin = MOCK_AUTH_DEFAULT_PIN,
): Promise<void> {
  const companionHome = popupPage.getByTestId('extension-toolbar-menu')
  const pinUnlock = popupPage.getByTestId('device-protection-pin-unlock-btn')
  const initialSetup = popupPage.getByTestId(
    'device-protection-create-new-choice',
  )
  const visibleSurface = companionHome.or(pinUnlock).or(initialSetup).first()
  await expect(visibleSurface).toBeVisible({
    timeout: 45_000,
  })

  const surfaceObservation: PinDeviceEntrySurfaceObservation = {
    companionHomeVisible: await companionHome.isVisible(),
    pinUnlockVisible: await pinUnlock.isVisible(),
    initialSetupVisible: await initialSetup.isVisible(),
  }
  const entrySurface = classifyPinDeviceEntrySurface(surfaceObservation)
  if (entrySurface === PinDeviceEntrySurfaceKind.Waiting) {
    throw new Error(
      'Extension popup did not expose a device-protection surface.',
    )
  }
  if (entrySurface === PinDeviceEntrySurfaceKind.Ambiguous) {
    throw new Error(
      'Extension popup exposed multiple device-protection surfaces.',
    )
  }
  if (entrySurface === PinDeviceEntrySurfaceKind.CompanionHome) return
  if (entrySurface === PinDeviceEntrySurfaceKind.PinUnlock) {
    await popupPage.getByTestId('device-protection-pin-unlock-input').fill(pin)
    await pinUnlock.click()
    await expect(companionHome).toBeVisible({ timeout: 45_000 })
    return
  }

  await initialSetup.click()
  await popupPage.getByTestId('device-protection-setup-btn').click()
  await expect(
    popupPage.getByTestId('device-protection-pin-input'),
  ).toBeVisible({ timeout: 45_000 })
  await popupPage.getByTestId('device-protection-pin-input').fill(pin)
  await popupPage.getByTestId('device-protection-pin-confirm').fill(pin)
  await popupPage.getByTestId('device-protection-pin-setup-btn').click()
  await expect(companionHome).toBeVisible({ timeout: 45_000 })
}
