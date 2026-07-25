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
  getShellTemplate,
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
const templateIds = listShellTemplateIds()
const singleStepPasswordTemplates = templateIds.filter((templateId) => {
  const template = getShellTemplate(templateId)
  return (
    Boolean(template) &&
    template!.steps.length === 1 &&
    template!.steps[0]?.fields.some((field) => field.type === 'password')
  )
})

test.describe('popular login fixture coverage', () => {
  test.describe.configure({ timeout: 180_000 })

  test('catalog maps to shared templates; CI covers unique shells only', () => {
    expect(catalog).toHaveLength(1000)
    expect(siteShellCount()).toBe(1000)
    expect(templateIds.length).toBeGreaterThan(0)
    expect(templateIds.length).toBeLessThan(100)
    for (const site of catalog) {
      expect(resolveSiteFixture(site.id)?.template).toBeTruthy()
    }
  })

  test('shows Pilot Continue with Nook on every unique shell template', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Popular login templates vault',
    })
    try {
      for (const templateId of templateIds) {
        const page = await paired.context.newPage()
        await page.goto(`${mockAuth.origin}/template/${templateId}`)
        const widget = page.locator('#nook-auth-widget')
        await expect(
          widget.getByRole('button', { name: 'Continue with Nook' }),
          `Pilot missing for template ${templateId}`,
        ).toBeVisible({ timeout: 20_000 })
        await expect(page.getByTestId('mock-auth-scenario')).toHaveText(
          `${templateId}-login`,
        )
        await page.close()
      }
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('fills single-step password shell templates to success', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
    expect(singleStepPasswordTemplates.length).toBeGreaterThan(0)

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

      for (const templateId of singleStepPasswordTemplates) {
        const page = await paired.context.newPage()
        await page.goto(`${mockAuth.origin}/template/${templateId}`)
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
