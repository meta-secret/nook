import { expect, type BrowserContext, type Page } from '@playwright/test'
import { EXTENSION_UNLOCK_TIMEOUT_MS } from './extension-smoke-runtime'

export enum PairedVaultCompanionUnlockKind {
  Optional = 'optional',
  Required = 'required',
}

export type PairedVaultCompanionUnlock = {
  readonly context: BrowserContext
  readonly vaultPage: Page
  readonly companionUnlock: PairedVaultCompanionUnlockKind
  readonly extensionId: string
}

type CompanionPopupUnlock = {
  readonly page: Page
}

type OwnedCompanionPopupOpen = {
  readonly context: BrowserContext
  readonly extensionId: string
}

const COMPANION_UNLOCK_ADOPT_WAIT_MS = 3_000

async function openOwnedCompanionPopup(
  request: OwnedCompanionPopupOpen,
): Promise<Page> {
  const popupPage = await request.context.newPage()
  await popupPage.goto(
    `chrome-extension://${request.extensionId}/popup/index.html`,
  )
  return popupPage
}

async function completeCompanionPopupUnlock(
  request: CompanionPopupUnlock,
): Promise<void> {
  const { page } = request
  const deviceSetup = page.getByTestId('extension-device-setup')
  const companionHome = page.getByTestId('extension-toolbar-menu')
  await expect(deviceSetup.or(companionHome)).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
  if (!(await deviceSetup.isVisible())) {
    return
  }
  await page.getByTestId('device-protection-unlock-btn').click()
  await expect(companionHome).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}

export async function unlockPairedVaultThroughCompanion(
  request: PairedVaultCompanionUnlock,
): Promise<void> {
  const { context, vaultPage, companionUnlock, extensionId } = request
  await vaultPage.getByTestId('unlock-vault-btn').click()
  await expect(vaultPage.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  if (companionUnlock === PairedVaultCompanionUnlockKind.Optional) {
    try {
      await expect(vaultPage.getByTestId('authenticated-shell')).toBeVisible({
        timeout: COMPANION_UNLOCK_ADOPT_WAIT_MS,
      })
      return
    } catch {
      // The extension session is locked; unlock it through the companion popup.
    }
  }
  const ownedPopupOpen: OwnedCompanionPopupOpen = { context, extensionId }
  const companionUnlockPage: CompanionPopupUnlock = {
    page: await openOwnedCompanionPopup(ownedPopupOpen),
  }
  await completeCompanionPopupUnlock(companionUnlockPage)
  await expect(vaultPage.getByTestId('authenticated-shell')).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}
