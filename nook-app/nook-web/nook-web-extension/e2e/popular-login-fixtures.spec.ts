import { expect, test } from '@playwright/test'
import {
  launchPairedPinExtension,
  saveVaultLogin,
} from './helpers/paired-pin-extension'
import { startMockAuthServer } from './mock-auth'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listShellTemplateIds,
  resolveSiteFixture,
  siteShellCount,
} from './mock-auth/fixtures/resolve-site-fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogPath = path.resolve(
  here,
  '../../../nook-core/data/popular_login_sites.json',
)

type CatalogEntry = { id: string }

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogEntry[]
const singleStepPasswordIds = catalog
  .map((site) => {
    const fixture = resolveSiteFixture(site.id)
    const single =
      Boolean(fixture) &&
      fixture!.steps.length === 1 &&
      fixture!.steps[0]?.fields.some((field) => field.type === 'password')
    return single ? site.id : undefined
  })
  .filter((id): id is string => Boolean(id))

test.describe('popular login fixture coverage', () => {
  test.describe.configure({ timeout: 600_000 })

  test('catalog maps to shared templates without per-site duplicates', () => {
    expect(catalog).toHaveLength(100)
    expect(siteShellCount()).toBe(100)
    expect(listShellTemplateIds().length).toBeGreaterThan(0)
    expect(listShellTemplateIds().length).toBeLessThan(100)
    for (const site of catalog) {
      expect(resolveSiteFixture(site.id)?.id).toBe(site.id)
    }
  })

  test('shows Pilot Continue with Nook on every popular-site mock', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Popular login fixtures vault',
    })
    try {
      for (const site of catalog) {
        const page = await paired.context.newPage()
        await page.goto(`${mockAuth.origin}/site/${site.id}`)
        const widget = page.locator('#nook-auth-widget')
        await expect(
          widget.getByRole('button', { name: 'Continue with Nook' }),
          `Pilot missing for ${site.id}`,
        ).toBeVisible({ timeout: 20_000 })
        await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
          `${site.id}-login`,
        )
        await page.close()
      }
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('fills single-step password popular-site mocks to success', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
    expect(singleStepPasswordIds.length).toBeGreaterThan(10)

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Popular login fill vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      for (const siteId of singleStepPasswordIds) {
        const page = await paired.context.newPage()
        await page.goto(`${mockAuth.origin}/site/${siteId}`)
        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible({
          timeout: 20_000,
        })
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.getByTestId('mock-auth-success')).toHaveText(
          'Authentication complete',
          { timeout: 20_000 },
        )
        await page.close()
      }
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
