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

export async function unlockExtensionThroughCompanion({
  context,
  extensionId,
}: {
  context: BrowserContext
  extensionId: string
}): Promise<void> {
  const companionUnlockPage = await openOwnedCompanionPopup({
    context,
    extensionId,
  })
  try {
    await completeCompanionPopupUnlock({ page: companionUnlockPage })
  } finally {
    await companionUnlockPage.close()
  }
}

export async function unlockPairedVaultThroughCompanion(
  request: PairedVaultCompanionUnlock,
): Promise<void> {
  const { context, vaultPage, companionUnlock, extensionId } = request
  const authenticatedShell = vaultPage.getByTestId('authenticated-shell')
  const unlockButton = vaultPage.getByTestId('unlock-vault-btn')

  await expect(authenticatedShell.or(unlockButton)).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
  if (
    companionUnlock === PairedVaultCompanionUnlockKind.Required ||
    !(await authenticatedShell.isVisible())
  ) {
    await unlockExtensionThroughCompanion({ context, extensionId })
  }

  if (await unlockButton.isVisible()) {
    await unlockButton.click()
  }

  await expect(vaultPage.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  await expect(authenticatedShell).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}
