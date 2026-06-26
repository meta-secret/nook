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
    await expect(row.getByTestId('seed-word-12')).toHaveText('about')
  })

  test('blocks save when checksum is invalid', async ({ page }) => {
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-seed-phrase').click()
    await page.getByTestId('secret-label').fill('Bad checksum')
    await fillSeedPhraseGrid(
      page,
      Array.from({ length: 12 }, () => 'able'),
    )

    await expect(page.getByTestId('seed-phrase-checksum-error')).toBeVisible()
    await expect(page.getByTestId('save-secret-btn')).toBeDisabled()
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
    await expect(page.getByTestId('seed-word-12')).toHaveValue('about')
    await expect(page.getByTestId('save-secret-btn')).toBeEnabled()
  })

  test('clears the entire phrase to start over', async ({ page }) => {
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-seed-phrase').click()
    await fillSeedPhraseGrid(page, BIP39_SAMPLE_WORDS.slice(0, 3))

    const clearButton = page.getByTestId('seed-phrase-clear-btn')
    await expect(clearButton).toBeEnabled()
    await clearButton.click()

    await expect(page.getByTestId('seed-word-1')).toHaveValue('')
    await expect(page.getByTestId('seed-word-12')).toHaveValue('')
    await expect(clearButton).toBeDisabled()
    await expect(page.getByTestId('save-secret-btn')).toBeDisabled()
  })

  test('shows autocomplete suggestions while typing', async ({ page }) => {
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-seed-phrase').click()
    await page.getByTestId('seed-word-1').fill('aba')

    await expect(page.getByTestId('seed-word-suggestions')).toBeVisible()
    await page.getByTestId('seed-word-suggestion-abandon').click()
    await expect(page.getByTestId('seed-word-1')).toHaveValue('abandon')
  })
})
