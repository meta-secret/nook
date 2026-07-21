import { expect, test } from '../fixtures'
import { connectLocalVault, UI_TIMEOUT_MS } from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Parameters<typeof connectLocalVault>[0]) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('upload an encrypted file attachment and download it after reveal', async ({
  page,
}) => {
  await connectLocalVault(page)
  await demoBeat(page)

  await page.getByTestId('add-secret-btn').click()
  await demoBeat(page)
  await page.getByTestId('item-type-file-attachment').click()
  await demoBeat(page)

  await page.getByTestId('file-attachment-title').fill('Recovery PDF')
  await page.getByTestId('file-attachment-input').setInputFiles({
    name: 'recovery.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('nook demo file attachment', 'utf8'),
  })
  await expect(page.getByTestId('file-attachment-selected')).toContainText(
    'recovery.txt',
  )
  await demoBeat(page)

  await page.getByTestId('save-secret-btn').click()
  const row = page.getByTestId('secret-row').filter({ hasText: 'Recovery PDF' })
  await expect(page.getByTestId('vault-group-file-attachment')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(row.getByTestId('file-attachment-name')).toHaveText(
    'recovery.txt',
  )
  await demoBeat(page)

  await row.getByTestId('secret-row-toggle').click()
  await demoBeat(page)
  await row.getByTestId('reveal-secret-btn').click()
  await expect(row.getByTestId('download-file-attachment-btn')).toBeEnabled({
    timeout: UI_TIMEOUT_MS,
  })
  await demoBeat(page)

  const downloadPromise = page.waitForEvent('download')
  await row.getByTestId('download-file-attachment-btn').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('recovery.txt')
  await demoBeat(page)
})
