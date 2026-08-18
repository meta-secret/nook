import { expect, type BrowserContext, type Page } from '@playwright/test'
import { EXTENSION_UNLOCK_TIMEOUT_MS } from './extension-smoke-runtime'

export enum PairedVaultCompanionUnlockKind {
  Optional = 'optional',
  Required = 'required',
}

enum CompanionUnlockPageSearchKind {
  Found = 'found',
  Missing = 'missing',
}

export type PairedVaultCompanionUnlock = {
  readonly context: BrowserContext
  readonly vaultPage: Page
  readonly companionUnlock: PairedVaultCompanionUnlockKind
}

type CompanionPopupUnlock = {
  readonly page: Page
}

type DelayWait = {
  readonly durationMs: number
}

type CompanionUnlockPageSearch = {
  readonly context: BrowserContext
}

type CompanionUnlockPageSearchResult =
  | {
      readonly kind: CompanionUnlockPageSearchKind.Found
      readonly page: Page
    }
  | { readonly kind: CompanionUnlockPageSearchKind.Missing }

type NewCompanionPopupSearch = {
  readonly context: BrowserContext
  readonly knownPages: ReadonlySet<Page>
}

type PairedCompanionUnlockPoll = {
  readonly context: BrowserContext
  readonly vaultPage: Page
  readonly companionUnlock: PairedVaultCompanionUnlockKind
  readonly knownPages: ReadonlySet<Page>
}

const COMPANION_UNLOCK_POLL_MS = 100

function delay(request: DelayWait): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, request.durationMs)
  })
}

function isCompanionPopupUrl(request: CompanionPopupUnlock): boolean {
  return request.page.url().includes('/popup/index.html')
}

async function findVisibleCompanionUnlockPage(
  request: CompanionUnlockPageSearch,
): Promise<CompanionUnlockPageSearchResult> {
  for (const page of request.context.pages()) {
    if (page.isClosed()) {
      continue
    }
    const popupPage: CompanionPopupUnlock = { page }
    if (!isCompanionPopupUrl(popupPage)) {
      continue
    }
    const unlockButton = page.getByTestId('device-protection-unlock-btn')
    if (await unlockButton.isVisible()) {
      const found: CompanionUnlockPageSearchResult = {
        kind: CompanionUnlockPageSearchKind.Found,
        page,
      }
      return found
    }
  }
  const missing: CompanionUnlockPageSearchResult = {
    kind: CompanionUnlockPageSearchKind.Missing,
  }
  return missing
}

async function findNewCompanionPopupPage(
  request: NewCompanionPopupSearch,
): Promise<CompanionUnlockPageSearchResult> {
  for (const page of request.context.pages()) {
    if (request.knownPages.has(page) || page.isClosed()) {
      continue
    }
    const popupPage: CompanionPopupUnlock = { page }
    if (!isCompanionPopupUrl(popupPage)) {
      continue
    }
    const found: CompanionUnlockPageSearchResult = {
      kind: CompanionUnlockPageSearchKind.Found,
      page,
    }
    return found
  }
  const missing: CompanionUnlockPageSearchResult = {
    kind: CompanionUnlockPageSearchKind.Missing,
  }
  return missing
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

async function completePairedCompanionUnlock(
  request: PairedCompanionUnlockPoll,
): Promise<void> {
  const deadline = Date.now() + EXTENSION_UNLOCK_TIMEOUT_MS
  const pollDelay: DelayWait = { durationMs: COMPANION_UNLOCK_POLL_MS }
  while (Date.now() < deadline) {
    if (request.companionUnlock === PairedVaultCompanionUnlockKind.Optional) {
      if (
        await request.vaultPage.getByTestId('authenticated-shell').isVisible()
      ) {
        return
      }
    }
    const visibleUnlockSearch: CompanionUnlockPageSearch = {
      context: request.context,
    }
    const visibleUnlock =
      await findVisibleCompanionUnlockPage(visibleUnlockSearch)
    if (visibleUnlock.kind === CompanionUnlockPageSearchKind.Found) {
      const companionUnlockPage: CompanionPopupUnlock = {
        page: visibleUnlock.page,
      }
      await completeCompanionPopupUnlock(companionUnlockPage)
      return
    }
    const newPopupSearch: NewCompanionPopupSearch = {
      context: request.context,
      knownPages: request.knownPages,
    }
    const newPopup = await findNewCompanionPopupPage(newPopupSearch)
    if (newPopup.kind === CompanionUnlockPageSearchKind.Found) {
      const companionUnlockPage: CompanionPopupUnlock = {
        page: newPopup.page,
      }
      await completeCompanionPopupUnlock(companionUnlockPage)
      return
    }
    await delay(pollDelay)
  }
  throw new Error(
    'Paired vault companion unlock did not show a popup or authenticated shell',
  )
}

export async function unlockPairedVaultThroughCompanion(
  request: PairedVaultCompanionUnlock,
): Promise<void> {
  const { context, vaultPage, companionUnlock } = request
  const knownPages: ReadonlySet<Page> = new Set(context.pages())
  await vaultPage.getByTestId('unlock-vault-btn').click()
  await expect(vaultPage.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  const unlockPoll: PairedCompanionUnlockPoll = {
    context,
    vaultPage,
    companionUnlock,
    knownPages,
  }
  await completePairedCompanionUnlock(unlockPoll)
  await expect(vaultPage.getByTestId('authenticated-shell')).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}
