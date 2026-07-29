import { expect, type Page } from '@playwright/test'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from './environment'
import { unlockVaultOnLogin } from './settings-auth'
import { disableVaultIdleLock, waitForStorageChainIdle } from './vault-runtime'

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

export async function createLocalVaultOnLogin(
  page: Page,
  vaultName = 'Test vault',
  readyTestId = 'vault-panel',
) {
  const chooser = page.getByTestId('login-create-vault-chooser')
  await expect(chooser).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  const finalStep = page.getByTestId('create-vault-wizard-create')
  if (!(await finalStep.isVisible())) {
    const simplePath = page.getByTestId('get-started-path-simple')
    await expect(simplePath).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await simplePath.click()
    await expect(finalStep).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  }

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

  // Deferred passkey: empty create may show the top-right overlay first.
  const passkeyOverlay = page.getByTestId('passkey-auth-overlay')
  const readySurface = page.getByTestId(readyTestId)
  await expect
    .poll(
      async () =>
        (await passkeyOverlay.isVisible()) || (await readySurface.isVisible()),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
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
  if (await chooser.isVisible()) {
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
    await page.getByTestId(`seed-word-${index + 1}`).fill(words[index]!)
  }
}
