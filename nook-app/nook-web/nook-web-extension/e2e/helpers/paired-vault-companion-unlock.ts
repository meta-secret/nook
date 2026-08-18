import { expect, type BrowserContext, type Page } from '@playwright/test'
import { EXTENSION_UNLOCK_TIMEOUT_MS } from './extension-smoke-runtime'

export enum PairedVaultCompanionUnlockKind {
  Optional = 'optional',
  Required = 'required',
}

enum PairedUnlockProgressKind {
  CompanionPopup = 'companion-popup',
  VaultUnlocked = 'vault-unlocked',
}

export type PairedVaultCompanionUnlock = {
  readonly context: BrowserContext
  readonly vaultPage: Page
  readonly companionUnlock: PairedVaultCompanionUnlockKind
}

type CompanionPopupUnlock = {
  readonly page: Page
}

type PairedUnlockProgressWait = {
  readonly companionPagePromise: Promise<Page>
  readonly vaultPage: Page
}

type PairedUnlockProgress =
  | {
      readonly kind: PairedUnlockProgressKind.CompanionPopup
      readonly page: Page
    }
  | { readonly kind: PairedUnlockProgressKind.VaultUnlocked }

type CompanionPopupPageWait = {
  readonly predicate: (page: Page) => boolean
  readonly timeout: number
}

async function completeCompanionPopupUnlock(
  request: CompanionPopupUnlock,
): Promise<void> {
  const { page } = request
  await expect(page.getByTestId('extension-device-setup')).toBeVisible()
  await page.getByTestId('device-protection-unlock-btn').click()
  await expect(page.getByTestId('extension-companion-home')).toBeVisible()
}

async function waitForPairedUnlockProgress(
  request: PairedUnlockProgressWait,
): Promise<PairedUnlockProgress> {
  const companionOpened = request.companionPagePromise.then((page) => {
    const progress: PairedUnlockProgress = {
      kind: PairedUnlockProgressKind.CompanionPopup,
      page,
    }
    return progress
  })
  const vaultUnlocked = request.vaultPage
    .getByTestId('authenticated-shell')
    .waitFor({
      state: 'visible',
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    .then(() => {
      const progress: PairedUnlockProgress = {
        kind: PairedUnlockProgressKind.VaultUnlocked,
      }
      return progress
    })
  return Promise.race([companionOpened, vaultUnlocked])
}

export async function unlockPairedVaultThroughCompanion(
  request: PairedVaultCompanionUnlock,
): Promise<void> {
  const { context, vaultPage, companionUnlock } = request
  const companionPageWait: CompanionPopupPageWait = {
    predicate: (page) => page.url().includes('/popup/index.html'),
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  }
  const companionPagePromise = context.waitForEvent('page', companionPageWait)
  await vaultPage.getByTestId('unlock-vault-btn').click()
  await expect(vaultPage.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  if (companionUnlock === PairedVaultCompanionUnlockKind.Required) {
    const companionUnlockPage: CompanionPopupUnlock = {
      page: await companionPagePromise,
    }
    await completeCompanionPopupUnlock(companionUnlockPage)
  } else {
    const progressWait: PairedUnlockProgressWait = {
      companionPagePromise,
      vaultPage,
    }
    const progress = await waitForPairedUnlockProgress(progressWait)
    if (progress.kind === PairedUnlockProgressKind.CompanionPopup) {
      const companionUnlockPage: CompanionPopupUnlock = {
        page: progress.page,
      }
      await completeCompanionPopupUnlock(companionUnlockPage)
    }
  }
  await expect(vaultPage.getByTestId('authenticated-shell')).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}
