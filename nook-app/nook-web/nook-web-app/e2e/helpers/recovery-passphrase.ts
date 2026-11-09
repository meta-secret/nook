import { expect, type Locator, type Page } from '@playwright/test'
import type { VaultDebugWindow } from '$lib/app/browser-lifecycle'
import { dumpNookLogs } from './app-logs'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from './environment'
import { answerPasskeyPromptBeforeJoin } from './identity-enrollment'
import { readLocalVaultYamlFromIdb, storeIdOfVaultYaml } from './local-sync'
import { revealSecretValue, waitForSecretOnDevice } from './secret-operations'
import { disableVaultIdleLock } from './vault-runtime'
import {
  ManagePage,
  openIdentitiesPage,
  openManagePage,
  openVaultPage,
  pressIfReady,
} from './workspace-navigation'

/** The label every e2e recovery passphrase is written down under. */
export const RECOVERY_PASSPHRASE_LABEL = 'Paper in the safe'

/** On the Keys page, add a recovery passphrase: name it, keep Standard,
 * read the words shown once, and type them back. The words are returned
 * as they were written down. */
export async function addRecoveryPassphrase(page: Page): Promise<string> {
  await openManagePage(page, ManagePage.Keys)
  await page.getByTestId('recovery-passphrase-add').click()
  await page
    .getByTestId('recovery-passphrase-label-input')
    .fill(RECOVERY_PASSPHRASE_LABEL)
  await page.getByTestId('recovery-passphrase-strength-choice-standard').click()
  await page.getByTestId('recovery-passphrase-generate').click()
  const words = page.getByTestId('recovery-passphrase-word')
  await expect(words).toHaveCount(4, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  const written = (await words.allTextContents()).map((word) => word.trim())
  await page.getByTestId('recovery-passphrase-written').click()
  await expect(words).toHaveCount(0)
  await page
    .getByTestId('recovery-passphrase-confirm-words')
    .fill(written.join(' '))
  await page.getByTestId('recovery-passphrase-confirm').click()
  await expect(page.getByTestId('recovery-passphrase')).toContainText(
    RECOVERY_PASSPHRASE_LABEL,
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  return written.join(' ')
}

/** Sync now on the Devices page puts the keyring's log, the passphrase in
 * it, on its sync provider. */
export async function syncKeyringNow(page: Page): Promise<void> {
  await openManagePage(page, ManagePage.Devices)
  const syncNow = page.getByTestId('identity-sync-now-btn')
  await expect(syncNow).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await syncNow.click()
  await expect(syncNow).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

/** One Simple vault of a keyring and the secret it keeps. */
export type KeptVault = {
  readonly storeId: string
  readonly key: string
  readonly value: string
}

/** The store id of the vault open on this browser. */
export async function openStoreId(page: Page): Promise<string> {
  return storeIdOfVaultYaml(await readLocalVaultYamlFromIdb(page))
}

/** The store id of the vault open on this browser, or none right after a
 * recovery, which opens no vault by itself. */
async function openStoreIdOrNone(device: Page): Promise<string> {
  const yaml = await readLocalVaultYamlFromIdb(device)
  const storeId = yaml.match(/^store_id:\s*(\S+)/m)?.[1]
  return storeId ? storeId : ''
}

/** Open one of the keyring's vaults from its row on the hub: one this
 * browser holds unlocks and opens from its panel; one only granted to it
 * opens from the keyring's provider as its row is picked, then from its
 * panel. */
async function openKeyringVault(device: Page, storeId: string): Promise<void> {
  await openIdentitiesPage(device)
  const row = device.locator(
    `[data-testid="identity-vault-row"][data-store-id="${storeId}"]`,
  )
  await expect(row).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  const controls = [
    device.getByTestId('vault-panel-unlock'),
    device.getByTestId('vault-panel-open'),
  ]
  // Selecting a vault this browser holds switches to it locked, so the
  // vault is open only once its unlocked panel or page shows.
  const unlocked = device
    .getByTestId('vault-panel-open')
    .or(device.getByTestId('vault-panel'))
    .first()
  await expect
    .poll(
      async () => {
        if (
          (await openStoreIdOrNone(device)) === storeId &&
          (await unlocked.isVisible())
        )
          return 'open'
        for (const control of controls) {
          if (await pressIfReady(control)) break
        }
        return 'waiting'
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe('open')
}

/** Print a recovered browser's state, page, and app logs. The fixture
 * reports the first browser only; a recovered one closes with its isolated
 * context, so its state is printed here when a step on it fails. */
export async function reportRecoveredDevice(
  device: Page,
  step: string,
): Promise<void> {
  const state = await device.evaluate(() => {
    const vault = (window as VaultDebugWindow).__nookVault
    return JSON.stringify({
      path: window.location.pathname,
      section: vault?.workspaceSection,
      active: vault?.activeVault,
      panel: vault?.vaultPanelStoreId,
      error: vault?.errorMsg,
    })
  })
  console.log(`[${step}] recovered device: ${state}`)
  console.log(await device.locator('body').ariaSnapshot())
  await dumpNookLogs(device, step)
}

/** Open one of the keyring's vaults and read its secret. */
export async function readSecretOfVault(
  device: Page,
  kept: KeptVault,
): Promise<string> {
  try {
    await openKeyringVault(device, kept.storeId)
    await disableVaultIdleLock(device)
    await openVaultPage(device)
    await waitForSecretOnDevice(device, kept.key)
    return await revealSecretValue(device, kept.key)
  } catch (error) {
    await reportRecoveredDevice(device, `readSecretOfVault ${kept.storeId}`)
    throw error
  }
}

/** On the recovery screen, the keyring filing the kept vault offers its
 * passkey, its words, and its devices, with nothing picked and no choice
 * that does nothing. Recovering with its words makes this browser's key
 * first, then the words let it in: the step's button is pressed to apply. */
export async function recoverListedKeyringWithWords(
  device: Page,
  ...[kept, apply, words]: readonly [KeptVault, Locator, string]
): Promise<void> {
  try {
    const card = device.locator(
      `[data-testid="provider-identity"][data-store-ids~="${kept.storeId}"]`,
    )
    await expect(card).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    const decisions = card.getByTestId('provider-identity-decision')
    await expect(decisions).toHaveCount(3)
    expect(
      await decisions.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('data-decision')),
      ),
    ).toEqual(['addToBrowser', 'recoverWithPassphrase', 'askToJoin'])
    await expect(card.locator('[aria-pressed="true"]')).toHaveCount(0)

    await card
      .locator(
        '[data-testid="provider-identity-decision"][data-decision="recoverWithPassphrase"]',
      )
      .click()
    await apply.click()
    const recovery = device.getByTestId('keyring-recovery-words')
    await answerPasskeyPromptBeforeJoin(device, recovery)
    await expect(recovery).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(
      device.getByTestId('first-run-recover-passphrase-label'),
    ).toContainText(RECOVERY_PASSPHRASE_LABEL, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await device.getByTestId('first-run-recover-words').fill(words)
    await device.getByTestId('first-run-recover-submit').click()
    await expect(recovery).toHaveCount(0, {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  } catch (error) {
    await reportRecoveredDevice(device, 'recoverListedKeyringWithWords')
    throw error
  }
}
