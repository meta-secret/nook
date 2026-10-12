import { expect, test } from '@playwright/test'

for (const width of [1280, 390]) {
  test(`workspace study supports item selection and settings at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'All items' })).toBeVisible()
    await page.getByRole('button', { name: 'Project notes' }).click()
    await expect(
      page.getByRole('heading', { name: 'Project notes' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page.getByRole('button', { name: 'All items', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Project notes' }),
    ).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflow).toBe(false)
  })
}
