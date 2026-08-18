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

type NewPageEventWait = {
  readonly timeout: number
}

type StaleCompanionReload = {
  readonly context: BrowserContext
  readonly reloadedPages: WeakSet<Page>
}

type UnlockRaceState = {
  done: boolean
}

type PairedCompanionUnlockPoll = {
  readonly context: BrowserContext
  readonly vaultPage: Page
  readonly companionUnlock: PairedVaultCompanionUnlockKind
  readonly reloadedPages: WeakSet<Page>
  readonly race: UnlockRaceState
}

type NewCompanionWindowUnlock = {
  readonly pagePromise: Promise<Page>
  readonly race: UnlockRaceState
}

const COMPANION_UNLOCK_POLL_MS = 100
const WAIT_FOR_EVENT_NO_TIMEOUT_MS = 0

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

async function reloadStaleCompanionPages(
  request: StaleCompanionReload,
): Promise<void> {
  for (const page of request.context.pages()) {
    if (page.isClosed() || request.reloadedPages.has(page)) {
      continue
    }
    const popupPage: CompanionPopupUnlock = { page }
    if (!isCompanionPopupUrl(popupPage)) {
      continue
    }
    const unlockButton = page.getByTestId('device-protection-unlock-btn')
    if (await unlockButton.isVisible()) {
      continue
    }
    request.reloadedPages.add(page)
    await page.reload()
  }
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

async function unlockFromNewCompanionWindow(
  request: NewCompanionWindowUnlock,
): Promise<void> {
  const page = await request.pagePromise
  if (request.race.done) {
    return
  }
  const popupPage: CompanionPopupUnlock = { page }
  if (!isCompanionPopupUrl(popupPage)) {
    await page.waitForURL(/\/popup\/index\.html/, {
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
  }
  if (request.race.done) {
    return
  }
  await completeCompanionPopupUnlock(popupPage)
  request.race.done = true
}

async function pollExistingCompanionUnlock(
  request: PairedCompanionUnlockPoll,
): Promise<void> {
  const deadline = Date.now() + EXTENSION_UNLOCK_TIMEOUT_MS
  const pollDelay: DelayWait = { durationMs: COMPANION_UNLOCK_POLL_MS }
  const visibleUnlockSearch: CompanionUnlockPageSearch = {
    context: request.context,
  }
  const staleReload: StaleCompanionReload = {
    context: request.context,
    reloadedPages: request.reloadedPages,
  }
  while (!request.race.done && Date.now() < deadline) {
    if (request.companionUnlock === PairedVaultCompanionUnlockKind.Optional) {
      if (
        await request.vaultPage.getByTestId('authenticated-shell').isVisible()
      ) {
        request.race.done = true
        return
      }
    }
    const visibleUnlock =
      await findVisibleCompanionUnlockPage(visibleUnlockSearch)
    if (visibleUnlock.kind === CompanionUnlockPageSearchKind.Found) {
      const companionUnlockPage: CompanionPopupUnlock = {
        page: visibleUnlock.page,
      }
      await completeCompanionPopupUnlock(companionUnlockPage)
      request.race.done = true
      return
    }
    await reloadStaleCompanionPages(staleReload)
    await delay(pollDelay)
  }
  if (request.race.done) {
    return
  }
  throw new Error(
    'Paired vault companion unlock did not show a popup or authenticated shell',
  )
}

export async function unlockPairedVaultThroughCompanion(
  request: PairedVaultCompanionUnlock,
): Promise<void> {
  const { context, vaultPage, companionUnlock } = request
  const race: UnlockRaceState = { done: false }
  const newPageWait: NewPageEventWait = {
    timeout: WAIT_FOR_EVENT_NO_TIMEOUT_MS,
  }
  const newCompanionPagePromise = context.waitForEvent('page', newPageWait)
  const newWindowUnlock: NewCompanionWindowUnlock = {
    pagePromise: newCompanionPagePromise,
    race,
  }
  await vaultPage.getByTestId('unlock-vault-btn').click()
  await expect(vaultPage.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  const existingUnlockPoll: PairedCompanionUnlockPoll = {
    context,
    vaultPage,
    companionUnlock,
    reloadedPages: new WeakSet<Page>(),
    race,
  }
  await Promise.race([
    unlockFromNewCompanionWindow(newWindowUnlock),
    pollExistingCompanionUnlock(existingUnlockPoll),
  ])
  race.done = true
  await expect(vaultPage.getByTestId('authenticated-shell')).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}
