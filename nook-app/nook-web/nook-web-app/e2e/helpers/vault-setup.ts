import { expect, type Locator, type Page } from '@playwright/test'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from './environment'
import { unlockVaultOnLogin } from './settings-auth'
import { disableVaultIdleLock, waitForStorageChainIdle } from './vault-runtime'
import { openVaultPage } from './workspace-navigation'

export async function openLoginProviderSetup(page: Page) {
  if (await page.getByTestId('provider-picker-list').isVisible()) {
    return
  }

  const connectBtn = page.getByTestId('login-connect-storage-btn')
  const legacyLink = page.getByTestId('login-use-storage-provider-link')
  const addBtn = page.getByTestId('add-provider-btn')
  const providerSetup = page.getByTestId('login-provider-setup')
  const providerEntryPoint = connectBtn
    .or(legacyLink)
    .or(addBtn)
    .or(providerSetup)
    .or(page.getByTestId('provider-picker-list'))

  await expect(providerEntryPoint.first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  if (await page.getByTestId('provider-picker-list').isVisible()) {
    return
  }

  if (await providerSetup.isVisible()) {
    await expect(page.getByTestId('provider-picker-list')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    return
  }

  if (await connectBtn.isVisible()) {
    await connectBtn.click()
  } else if (await legacyLink.isVisible()) {
    await legacyLink.click()
  } else {
    await addBtn.click()
  }

  await expect(page.getByTestId('provider-picker-list')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/**
 * A vault is created from an identity: the first-identity card shows the
 * setup directly, and an identity without vaults opens it from its card's
 * New vault row.
 */
export async function openFirstVaultSetup(page: Page) {
  const chooser = page.getByTestId('login-create-vault-chooser')
  const newVaultRow = page.getByTestId('identity-new-vault')
  await expect(chooser.or(newVaultRow).first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (!(await chooser.isVisible()) && (await newVaultRow.isVisible())) {
    await newVaultRow.click()
  }
}

/** Leave the first-run backup step for the new vault when it shows. */
export async function skipFirstRunBackup(
  page: Page,
  readySurface: Locator,
): Promise<void> {
  const backupStep = page.getByTestId('first-run-backup-step')
  await expect(backupStep.or(readySurface).first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await backupStep.isVisible()) {
    await page.getByTestId('first-run-backup-skip').click()
  }
}

/** The first vault's setup ends on the identities: skip the backup offer,
 * then open the new vault from its row there. */
export async function expectFirstVaultOpen(page: Page): Promise<void> {
  const vaultPanel = page.getByTestId('vault-panel')
  const hub = page.getByTestId('identities-hub')
  await skipFirstRunBackup(page, vaultPanel.or(hub).first())
  await openVaultPage(page)
}

export async function createLocalVaultOnLogin(
  page: Page,
  vaultName = 'Test vault',
  readyTestId = 'vault-panel',
) {
  await openFirstVaultSetup(page)
  const chooser = page.getByTestId('login-create-vault-chooser')
  await expect(chooser).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  // Simple and unified apps start with one name field; nothing to choose.
  const nameInput = page.getByTestId('login-vault-name-input')
  await expect(nameInput).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(nameInput).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await nameInput.fill(vaultName, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  const createButton = page.getByTestId('login-create-device-vault-btn')
  await expect(createButton).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await createButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  // Deferred passkey: the first-run protect step (or, elsewhere, the
  // top-right overlay) asks for it before the vault exists. The backup step
  // follows creation; tests that need it open Sync themselves.
  const passkeyOverlay = page
    .getByTestId('passkey-auth-overlay')
    .or(page.getByTestId('first-run-protect-step'))
  const readySurface = page.getByTestId(readyTestId)
  const backupStep = page.getByTestId('first-run-backup-step')
  const vaultError = page.getByTestId('vault-error')
  await expect
    .poll(
      async () =>
        (await passkeyOverlay.isVisible()) ||
        (await readySurface.isVisible()) ||
        (await backupStep.isVisible()) ||
        (await vaultError.isVisible()),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  if (await vaultError.isVisible()) {
    throw new Error(
      `Local vault creation failed: ${await vaultError.innerText()}`,
    )
  }
  if (await passkeyOverlay.isVisible()) {
    const createChoice = page.getByTestId('device-protection-create-new-choice')
    if (await createChoice.isVisible()) {
      await createChoice.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    }
    const setupBtn = page.getByTestId('device-protection-setup-btn')
    const unlockBtn = page.getByTestId('device-protection-unlock-btn')
    if (await setupBtn.isVisible()) {
      await setupBtn.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    } else if (await unlockBtn.isVisible()) {
      await unlockBtn.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    }
  }

  await skipFirstRunBackup(
    page,
    readySurface.or(page.getByTestId('identities-hub')).first(),
  )
  // The first vault's setup ends on the identities; the vault opens there.
  if (readyTestId === 'vault-panel') await openVaultPage(page)
  await expect(readySurface).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await disableVaultIdleLock(page)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            !(
              window as Window & {
                __nookVault?: { isVerifying?: boolean }
              }
            ).__nookVault?.isVerifying,
        ),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await waitForStorageChainIdle(page)
  await disableVaultIdleLock(page)
}

export async function connectLocalVault(page: Page) {
  await page.goto('/app/')
  await expect(
    page.getByTestId('vault-panel').or(page.getByTestId('login-gate')),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  if (await page.getByTestId('vault-panel').isVisible()) {
    await disableVaultIdleLock(page)
    return
  }

  const chooser = page.getByTestId('login-create-vault-chooser')
  const newVaultRow = page.getByTestId('identity-new-vault')
  const vaultRow = page.locator(
    '[data-testid="identity-vault-row"][data-state="available"], [data-testid="login-vault-option"]',
  )
  // The first-vault setup appears once the identity cards have loaded, so
  // wait for a settled login state before choosing between create and unlock.
  await expect(
    chooser
      .or(newVaultRow)
      .or(vaultRow)
      .or(page.getByTestId('vault-panel'))
      .first(),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  if (await page.getByTestId('vault-panel').isVisible()) {
    await disableVaultIdleLock(page)
    return
  }
  // A card that lists a vault unlocks it; its New vault row is not a first run.
  if (
    !(await vaultRow.first().isVisible()) &&
    ((await chooser.isVisible()) || (await newVaultRow.isVisible()))
  ) {
    await createLocalVaultOnLogin(page)
    await disableVaultIdleLock(page)
    return
  }

  await unlockVaultOnLogin(page)
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await disableVaultIdleLock(page)
}

export const BIP39_WORDLIST_ROUTE = '**/bip-0039/english.txt'

/** Valid BIP-39 test mnemonic (12 words). */
export const BIP39_SAMPLE_WORDS = [
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'about',
] as const

export function buildBip39WordlistBody(
  leadingWords: readonly string[] = BIP39_SAMPLE_WORDS,
): string {
  const words = [...leadingWords]
  let index = words.length
  while (words.length < 2048) {
    words.push(`testword${index}`)
    index += 1
  }
  return words.join('\n')
}

export async function mockBip39Wordlist(
  page: Page,
  leadingWords: readonly string[] = BIP39_SAMPLE_WORDS,
) {
  const body = buildBip39WordlistBody(leadingWords)
  await page.route(BIP39_WORDLIST_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body,
    })
  })
}

export async function fillSeedPhraseGrid(page: Page, words: readonly string[]) {
  if (words.length === 24) {
    await page.getByTestId('seed-word-count-24').click()
  }
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (typeof word !== 'string') {
      throw new Error(`seed word ${index + 1} was not available.`)
    }
    await page.getByTestId(`seed-word-${index + 1}`).fill(word)
  }
}
