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
  ShellTemplatePilotExpectation,
  siteShellCount,
} from './mock-auth/fixtures/resolve-site-fixture.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogPath = path.resolve(
  here,
  '../../../nook-platform/nook-core/data/popular_login_sites.json',
)

type CatalogEntry = { id: string }

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogEntry[]
const templateIds = listShellTemplateIds()

function requiredShellTemplate(templateId: string) {
  const template = getShellTemplate(templateId)
  if (!template) throw new Error(`shell template ${templateId} is missing`)
  return template
}

const continueWithNookTemplateIds = templateIds.filter((templateId) => {
  const template = requiredShellTemplate(templateId)
  return (
    template.pilotExpectation === ShellTemplatePilotExpectation.ContinueWithNook
  )
})
const failClosedTemplateIds = templateIds.filter((templateId) => {
  const template = requiredShellTemplate(templateId)
  return (
    template.pilotExpectation ===
    ShellTemplatePilotExpectation.FailClosedAlternateAuthentication
  )
})
const singleStepPasswordTemplates = continueWithNookTemplateIds.filter(
  (templateId) => {
    const template = requiredShellTemplate(templateId)
    return (
      template.steps.length === 1 &&
      template.steps[0]?.fields.some((field) => field.type === 'password')
    )
  },
)

test.describe('popular login fixture coverage', () => {
  test.describe.configure({ timeout: 180_000 })

  test('catalog maps to shared templates; CI covers unique shells only', () => {
    expect(catalog).toHaveLength(1000)
    expect(siteShellCount()).toBe(1000)
    expect(templateIds.length).toBeGreaterThan(0)
    expect(templateIds.length).toBeLessThan(100)
    expect(continueWithNookTemplateIds).toHaveLength(templateIds.length - 1)
    expect(failClosedTemplateIds).toEqual(['enterprise-sso-email'])
    for (const site of catalog) {
      expect(resolveSiteFixture(site.id)?.template).toBeTruthy()
    }
  })

  test('shows Pilot Continue with Nook on every eligible shell template', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Popular login templates vault',
    })
    try {
      for (const templateId of continueWithNookTemplateIds) {
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

  test('keeps alternate-auth-only shell templates fail closed', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Popular login rejected templates vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      for (const templateId of failClosedTemplateIds) {
        const page = await paired.context.newPage()
        await page.goto(`${mockAuth.origin}/template/${templateId}`)
        const email = page.getByRole('textbox', { name: 'Work email' })
        const form = page.locator('#login_form')
        await expect(email).toHaveValue('')
        await form.evaluate((element) => {
          if (!(element instanceof HTMLFormElement)) {
            throw new Error('enterprise SSO fixture form is missing')
          }
          document.documentElement.dataset.nookPilotObservation =
            document.querySelector('#nook-auth-widget') instanceof HTMLElement
              ? 'observed'
              : 'not-observed'
          document.documentElement.dataset.nookSubmissionObservation =
            'not-submitted'
          const observer = new MutationObserver(() => {
            if (
              document.querySelector('#nook-auth-widget') instanceof HTMLElement
            ) {
              document.documentElement.dataset.nookPilotObservation = 'observed'
            }
          })
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
          })
          element.addEventListener('submit', () => {
            document.documentElement.dataset.nookSubmissionObservation =
              'submitted'
          })
        })
        await page.waitForTimeout(2_000)
        await expect(page.locator('#nook-auth-widget')).toHaveCount(0)
        await expect(email).toHaveValue('')
        await expect(page.locator('html')).toHaveAttribute(
          'data-nook-pilot-observation',
          'not-observed',
        )
        await expect(page.locator('html')).toHaveAttribute(
          'data-nook-submission-observation',
          'not-submitted',
        )
        await expect(page.getByTestId('mock-auth-success')).toHaveCount(0)
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
