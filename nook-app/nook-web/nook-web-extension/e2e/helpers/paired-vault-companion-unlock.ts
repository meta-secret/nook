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
}

type CompanionPopupUnlock = {
  readonly page: Page
}

type ExtensionIdLookup = {
  readonly context: BrowserContext
}

type OwnedCompanionPopupOpen = {
  readonly context: BrowserContext
  readonly extensionId: string
}

const COMPANION_UNLOCK_ADOPT_WAIT_MS = 3_000

function readExtensionId(request: ExtensionIdLookup): string {
  for (const page of request.context.pages()) {
    if (!page.url().startsWith('chrome-extension://')) {
      continue
    }
    return new URL(page.url()).host
  }
  throw new Error('Extension page is not open')
}

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
  await expect(page.getByTestId('extension-device-setup')).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('device-protection-unlock-btn').click()
  await expect(page.getByTestId('extension-companion-home')).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}

export async function unlockPairedVaultThroughCompanion(
  request: PairedVaultCompanionUnlock,
): Promise<void> {
  const { context, vaultPage, companionUnlock } = request
  const extensionIdLookup: ExtensionIdLookup = { context }
  const extensionId = readExtensionId(extensionIdLookup)
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
