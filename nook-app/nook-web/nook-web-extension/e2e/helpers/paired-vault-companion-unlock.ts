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

type CompanionPopupHandle = {
  readonly page: Page
  readonly closeAfterUse: boolean
}

enum CompanionPopupLookupKind {
  Found = 'found',
  Missing = 'missing',
}

type CompanionPopupLookup =
  | {
      readonly kind: CompanionPopupLookupKind.Found
      readonly page: Page
    }
  | { readonly kind: CompanionPopupLookupKind.Missing }

type OwnedCompanionPopupOpen = {
  readonly context: BrowserContext
  readonly extensionId: string
  readonly ignoredPages: readonly Page[]
}

function companionPopupUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/popup/index.html`
}

function isOwnedCompanionPopup(page: Page, extensionId: string): boolean {
  return (
    !page.isClosed() && page.url().startsWith(companionPopupUrl(extensionId))
  )
}

function findOwnedCompanionPopup(
  request: OwnedCompanionPopupOpen,
): CompanionPopupLookup {
  const page = request.context
    .pages()
    .find(
      (page) =>
        !request.ignoredPages.includes(page) &&
        isOwnedCompanionPopup(page, request.extensionId),
    )
  return page
    ? { kind: CompanionPopupLookupKind.Found, page }
    : { kind: CompanionPopupLookupKind.Missing }
}

async function openOwnedCompanionPopup(
  request: OwnedCompanionPopupOpen,
): Promise<CompanionPopupHandle> {
  const existingPopup = findOwnedCompanionPopup(request)
  if (existingPopup.kind === CompanionPopupLookupKind.Found) {
    return { page: existingPopup.page, closeAfterUse: false }
  }

  const popupPage = await request.context.newPage()
  await popupPage.goto(companionPopupUrl(request.extensionId))
  return { page: popupPage, closeAfterUse: true }
}

async function waitForOwnedCompanionPopup(
  request: OwnedCompanionPopupOpen,
): Promise<CompanionPopupHandle> {
  const existingPopup = findOwnedCompanionPopup(request)
  if (existingPopup.kind === CompanionPopupLookupKind.Found) {
    return { page: existingPopup.page, closeAfterUse: true }
  }

  const popupPage = await request.context.waitForEvent('page', {
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    predicate: (page) =>
      !request.ignoredPages.includes(page) &&
      isOwnedCompanionPopup(page, request.extensionId),
  })
  return { page: popupPage, closeAfterUse: true }
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
  const companionPopup = await openOwnedCompanionPopup({
    context,
    extensionId,
    ignoredPages: [],
  })
  try {
    await completeCompanionPopupUnlock({ page: companionPopup.page })
  } finally {
    if (companionPopup.closeAfterUse && !companionPopup.page.isClosed()) {
      await companionPopup.page.close()
    }
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
  const authenticated = await authenticatedShell.isVisible()
  if (
    companionUnlock === PairedVaultCompanionUnlockKind.Required &&
    authenticated
  ) {
    await unlockExtensionThroughCompanion({ context, extensionId })
  } else if (!authenticated) {
    const existingCompanionPages = context
      .pages()
      .filter((page) => isOwnedCompanionPopup(page, extensionId))
    await unlockButton.click()
    await expect(vaultPage.getByTestId('passkey-auth-overlay')).toHaveCount(0)

    if (companionUnlock === PairedVaultCompanionUnlockKind.Optional) {
      try {
        await expect(authenticatedShell).toBeVisible({
          timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
        })
      } catch {
        const companionPopup = await waitForOwnedCompanionPopup({
          context,
          extensionId,
          ignoredPages: existingCompanionPages,
        })
        try {
          await completeCompanionPopupUnlock({ page: companionPopup.page })
        } finally {
          if (companionPopup.closeAfterUse && !companionPopup.page.isClosed()) {
            await companionPopup.page.close()
          }
        }
      }
    } else {
      const companionPopup = await waitForOwnedCompanionPopup({
        context,
        extensionId,
        ignoredPages: existingCompanionPages,
      })
      try {
        await completeCompanionPopupUnlock({ page: companionPopup.page })
      } finally {
        if (companionPopup.closeAfterUse && !companionPopup.page.isClosed()) {
          await companionPopup.page.close()
        }
      }
    }
  }

  await expect(authenticatedShell).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}
