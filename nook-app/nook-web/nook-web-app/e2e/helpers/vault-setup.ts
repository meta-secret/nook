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

/** The open vault's row on its identity card. The first-run setup renders
 * inside the identities hub and the cards follow it, so the row, not the
 * hub, shows that setup has finished. */
export function openVaultRow(page: Page): Locator {
  return page.locator('[data-testid="identity-vault-row"][data-state="open"]')
}

/** First run's first screen: create the identity. Its passkey comes next;
 * no vault exists until the identity is settled. */
export async function startFirstRun(page: Page): Promise<void> {
  const create = page.getByTestId('first-run-create-identity-btn')
  await expect(create).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await create.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

/** Answer the passkey prompt on screen: a browser without a key makes one
 * (first run's passkey step, or the overlay elsewhere); one with a key
 * unlocks it. */
export async function answerPasskeyPrompt(page: Page): Promise<void> {
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

/** A fresh browser makes its key the way a person does: Create identity,
 * then first run's passkey step. Setup then waits on its sync provider
 * step with the key ready. */
export async function createFirstRunKey(page: Page): Promise<void> {
  await startFirstRun(page)
  await expect(page.getByTestId('first-run-protect-step')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await answerPasskeyPrompt(page)
  await expect(page.getByTestId('first-run-sync-step')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** After the passkey, setup offers a sync provider: keep the new identity
 * on this browser instead and name it. */
export async function nameFirstIdentityOnly(
  page: Page,
  identityName: string,
): Promise<void> {
  const skip = page.getByTestId('first-run-sync-skip')
  await expect(skip).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await skip.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  const nameInput = page.getByTestId('first-run-identity-name-input')
  await expect(nameInput).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await nameInput.fill(identityName, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await page
    .getByTestId('first-run-identity-create-btn')
    .click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

/** Keep the new identity on this browser, name it, then create its first
 * vault under the same name when setup asks. */
export async function nameFirstIdentityHere(
  page: Page,
  vaultName: string,
): Promise<void> {
  await nameFirstIdentityOnly(page, vaultName)
  const vaultStep = page.getByTestId('first-run-vault-step')
  await expect(vaultStep).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await vaultStep
    .getByTestId('login-vault-name-input')
    .fill(vaultName, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await vaultStep
    .getByTestId('login-create-device-vault-btn')
    .click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

/** Name the identity when first run reaches its sync provider step; a
 * browser that already had an identity goes straight to its vault. */
async function nameFirstIdentityIfAsked(
  page: Page,
  vaultName: string,
  readySurface: Locator,
): Promise<void> {
  const syncStep = page.getByTestId('first-run-sync-step')
  await expect(syncStep.or(readySurface).first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await syncStep.isVisible()) await nameFirstIdentityHere(page, vaultName)
}

/** The first vault's setup ends on the identities: name the identity when
 * setup asks, then open the new vault from its row there. */
export async function expectFirstVaultOpen(
  page: Page,
  vaultName = 'Test vault',
): Promise<void> {
  const vaultPanel = page.getByTestId('vault-panel')
  const ready = vaultPanel.or(openVaultRow(page)).first()
  await nameFirstIdentityIfAsked(page, vaultName, ready)
  await expect(ready).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  // The e2e idle lock is 2.5 s: under load it can lock the new vault before
  // the identities page leads into it.
  await disableVaultIdleLock(page)
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

  // First run starts with Create identity: its passkey, then the sync
  // provider step (kept on this browser here), then the name. A browser
  // that already has an identity names its next vault at once.
  const createIdentity = page.getByTestId('first-run-create-identity-btn')
  const nameInput = page.getByTestId('login-vault-name-input')
  await expect(createIdentity.or(nameInput).first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await createIdentity.isVisible()) {
    await startFirstRun(page)
  } else {
    await expect(nameInput).toBeEnabled({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await nameInput.fill(vaultName, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    const createButton = page.getByTestId('login-create-device-vault-btn')
    await expect(createButton).toBeEnabled({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await createButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  }

  // Deferred passkey: the first-run protect step (or, elsewhere, the
  // top-right overlay) asks for it before anything is created. Tests that
  // need a sync provider add it themselves.
  const passkeyOverlay = page
    .getByTestId('passkey-auth-overlay')
    .or(page.getByTestId('first-run-protect-step'))
  const readySurface = page.getByTestId(readyTestId)
  const syncStep = page.getByTestId('first-run-sync-step')
  const vaultError = page.getByTestId('vault-error')
  await expect
    .poll(
      async () =>
        (await passkeyOverlay.isVisible()) ||
        (await readySurface.isVisible()) ||
        (await syncStep.isVisible()) ||
        (await vaultError.isVisible()),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  if (await vaultError.isVisible()) {
    throw new Error(
      `Local vault creation failed: ${await vaultError.innerText()}`,
    )
  }
  if (await passkeyOverlay.isVisible()) await answerPasskeyPrompt(page)

  await nameFirstIdentityIfAsked(
    page,
    vaultName,
    readySurface.or(openVaultRow(page)).first(),
  )
  // The vault exists now: keep the 2.5 s e2e idle lock from locking it while
  // the identities page leads into it.
  await disableVaultIdleLock(page)
  // The first vault's setup ends on the identities; the vault opens there.
  if (readyTestId === 'vault-panel' || readyTestId === 'authenticated-shell')
    await openVaultPage(page)
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
