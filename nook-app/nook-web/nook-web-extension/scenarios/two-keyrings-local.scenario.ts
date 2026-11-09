import { expect, test, type Page } from '@playwright/test'
import {
  nameFirstIdentityHere,
  openIdentitiesPage,
  openStoreId,
  openVaultPage,
} from '../../nook-web-app/e2e/helpers'
import { MOCK_AUTH_DEFAULT_PIN } from '../e2e/mock-auth/accounts'
import { firstPage } from './dev-browser'
import {
  protectWithPin,
  runScenario,
  saveLogin,
  startVaultWithPin,
} from './steps'

function keyringCard(page: Page, name: string) {
  return page.getByRole('article', { name })
}

/** Switch to a keyring on this browser and unlock it with its PIN. */
async function useKeyring(page: Page, name: string): Promise<void> {
  await openIdentitiesPage(page)
  const card = keyringCard(page, name)
  await card.getByTestId('identity-use').click()
  await expect(card).toHaveAttribute('data-status', 'locked')
  await card.getByTestId('identity-unlock').click()
  await card.getByTestId('card-pin-input').fill(MOCK_AUTH_DEFAULT_PIN)
  await card.getByTestId('card-pin-submit').click()
  await expect(card).toHaveAttribute('data-status', 'unlocked')
}

/** Open a keyring's vault from its card: it opens, with no error. */
async function openVaultFromCard(
  page: Page,
  ...[name, storeId]: readonly [string, string]
): Promise<void> {
  const card = keyringCard(page, name)
  await card
    .locator(`[data-testid="identity-vault-row"][data-store-id="${storeId}"]`)
    .click()
  const open = page.getByTestId('vault-panel-open')
  await expect(open.or(page.getByRole('alert')).first()).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await open.click()
  await expect(page.getByTestId('vault-panel')).toBeVisible()
  expect(await openStoreId(page)).toBe(storeId)
}

// One browser with two keyrings, each holding a vault, each protected with
// the scenario PIN. Switching between them and opening each one's vault
// from its card uses that keyring's own key: neither vault is refused.
test('two keyrings on one browser each open their own vault', async () => {
  await runScenario(async (devices) => {
    const browser = await devices.open('this-device')
    const page = await firstPage(browser)
    let firstStoreId = ''
    let tripStoreId = ''
    await devices.step('first keyring with a vault', async () => {
      await startVaultWithPin(browser)
      await nameFirstIdentityHere(page, 'First')
      await openVaultPage(page)
      await saveLogin(page)
      firstStoreId = await openStoreId(page)
    })
    await devices.step('second keyring with its own vault', async () => {
      await openIdentitiesPage(page)
      await page.getByTestId('identity-new').click()
      await page.getByTestId('new-identity-name-input').fill('Work')
      await page.getByTestId('new-identity-continue').click()
      await protectWithPin(page)
      await expect(page.getByTestId('new-identity-ready')).toBeVisible()
      await page.getByTestId('new-identity-vault-input').fill('Trip')
      await page.getByTestId('new-identity-create-vault').click()
      await expect.poll(() => openStoreId(page)).not.toBe(firstStoreId)
      tripStoreId = await openStoreId(page)
    })
    await devices.step(
      'back on the first keyring, its vault opens',
      async () => {
        await useKeyring(page, 'First')
        await openVaultFromCard(page, 'First', firstStoreId)
      },
    )
    await devices.step(
      'back on the second keyring, its vault opens',
      async () => {
        await useKeyring(page, 'Work')
        await openVaultFromCard(page, 'Work', tripStoreId)
      },
    )
  })
})
