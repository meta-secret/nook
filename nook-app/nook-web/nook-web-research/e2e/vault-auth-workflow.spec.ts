import { expect, test } from '@playwright/test'

const studies = [
  {
    slug: 'key-later-sentinel-card-stack',
    destination: 'Sentinel card stack · default',
    confirmation: 'Nook threshold wallet',
  },
  {
    slug: 'landing-sentinel-card-stack',
    destination: 'Vault terminal',
    confirmation: '◆ Vault name Field notes',
  },
]

for (const { slug, destination, confirmation } of studies) {
  test(`${slug} opens its Sentinel setup and returns to a fresh chooser`, async ({
    page,
  }) => {
    await page.goto(`/experiments/${slug}`)

    const name = page.getByPlaceholder('Vault name')
    await name.fill('  Field notes  ')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Build Sentinel vault' }).click()
    await page.getByRole('button', { name: destination }).click()

    await expect(page.getByText(confirmation, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Auth chooser' }).click()
    await expect(name).toHaveValue('')
    await expect(
      page.getByRole('button', { name: 'Continue', exact: true }),
    ).toBeDisabled()
  })
}
