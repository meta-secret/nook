import { expect, test } from '@playwright/test'
import {
  BIP39_SAMPLE_WORDS,
  clearBrowserVault,
  connectLocalVault,
  expandSecretRow,
  fillSeedPhraseGrid,
  mockBip39Wordlist,
  UI_TIMEOUT_MS,
} from './helpers'

test.describe('BIP39 seed phrase grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await mockBip39Wordlist(page)
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
  })

  test('adds, validates, and reveals a 12-word mnemonic', async ({ page }) => {
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-seed-phrase').click()
    await page.getByTestId('secret-label').fill('Recovery wallet')
    await fillSeedPhraseGrid(page, BIP39_SAMPLE_WORDS)

    const saveButton = page.getByTestId('save-secret-btn')
    await expect(saveButton).toBeEnabled()
    await saveButton.click()

    const row = page
      .getByTestId('secret-row')
      .filter({ hasText: 'Recovery wallet' })
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await expandSecretRow(page, 'Recovery wallet')
    await expect(row.getByTestId('seed-phrase-grid')).toBeVisible()

    await row.getByRole('button', { name: 'Show secret' }).click()
    await expect(row.getByTestId('seed-word-1')).toHaveText('abandon')
    await expect(row.getByTestId('seed-word-12')).toHaveText('accident')
  })

  test('blocks save when a word is not in the official list', async ({
    page,
  }) => {
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-seed-phrase').click()
    await page.getByTestId('secret-label').fill('Invalid wallet')
    await fillSeedPhraseGrid(page, [
      ...BIP39_SAMPLE_WORDS.slice(0, 11),
      'notaword',
    ])

    await expect(page.getByTestId('seed-word-12')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(page.getByTestId('save-secret-btn')).toBeDisabled()
  })

  test('fills the grid when a mnemonic is pasted', async ({ page }) => {
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-seed-phrase').click()
    await page.getByTestId('seed-word-1').fill(BIP39_SAMPLE_WORDS.join(' '))

    await expect(page.getByTestId('seed-word-1')).toHaveValue('abandon')
    await expect(page.getByTestId('seed-word-12')).toHaveValue('accident')
    await expect(page.getByTestId('save-secret-btn')).toBeEnabled()
  })
})
