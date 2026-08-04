import { expect, test } from '@playwright/test'

test.describe('identity bridge', () => {
  test('switches identities, vaults, and relationship perspectives', async ({
    page,
  }) => {
    await page.goto('/experiments/identity-bridge')

    await expect(
      page.getByRole('heading', {
        name: 'Nora connects its devices to 2 vaults.',
      }),
    ).toBeVisible()

    await page
      .getByRole('button', { name: 'Northstar studio, Collective identity' })
      .click()
    await expect(
      page.getByRole('heading', {
        name: 'Northstar studio connects its devices to 2 vaults.',
      }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Vault', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: '1 identity can open Home.' }),
    ).toBeVisible()

    await page
      .getByRole('button', { name: 'Shared credentials, Sentinel vault' })
      .click()
    await expect(
      page.getByRole('heading', {
        name: '2 identities can open Shared credentials.',
      }),
    ).toBeVisible()
  })

  test('uses the compact graph with visible stage hierarchy', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/experiments/identity-bridge')

    const graph = page.getByTestId('identity-bridge-graph')
    await expect(graph).toHaveClass(/compact-canvas/)
    await expect(
      graph.getByText('Device evidence', { exact: true }),
    ).toBeVisible()
    await expect(
      graph.getByText('Distributed identity', { exact: true }),
    ).toBeVisible()
    await expect(graph.getByText('Vault grants', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Vault', exact: true }).click()
    await expect(
      graph.getByText('Selected vault', { exact: true }),
    ).toBeVisible()
    await expect(
      graph.getByText('Authorized identities', { exact: true }),
    ).toBeVisible()
  })

  test('switches distributed identities with accessible mobile selectors', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/experiments/identity-keys')

    await expect(
      page.getByRole('heading', { name: 'Nora lives across 3 devices.' }),
    ).toBeVisible()

    const northstar = page.getByRole('button', {
      name: 'Northstar studio, Collective identity, 2 devices',
    })
    await expect(northstar).toBeVisible()
    await northstar.click()
    await expect(
      page.getByRole('heading', {
        name: 'Northstar studio lives across 2 devices.',
      }),
    ).toBeVisible()
    await expect(northstar).toHaveAttribute('aria-current', 'page')
  })
})
