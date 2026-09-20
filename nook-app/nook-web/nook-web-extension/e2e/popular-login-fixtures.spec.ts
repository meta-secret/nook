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
  listSiteShellIds,
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

class PopularLoginCatalogDecoder {
  decode(value: unknown): CatalogEntry[] {
    if (!Array.isArray(value)) {
      throw new TypeError('popular login catalog must be an array')
    }
    const catalog: CatalogEntry[] = []
    for (const entry of value) catalog.push(this.decodeEntry(entry))
    return catalog
  }

  private decodeEntry(value: unknown): CatalogEntry {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('id' in value) ||
      typeof value.id !== 'string'
    ) {
      throw new TypeError('popular login catalog entry has an invalid shape')
    }
    return { id: value.id }
  }
}

const safeJson: { parse: (value: string) => unknown } = JSON
const parsedCatalog: unknown = safeJson.parse(readFileSync(catalogPath, 'utf8'))
const catalog = new PopularLoginCatalogDecoder().decode(parsedCatalog)
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

type CredentialPairTemplateId =
  | 'account-number-password'
  | 'dual-identity-password'
  | 'employee-id-password'
  | 'member-id-password'
  | 'email-password'
  | 'username-password'

type CredentialPairInputType = 'email' | 'text'

type CredentialPairFieldExpectation = {
  readonly identityName: string
  readonly identityType: CredentialPairInputType
  readonly identityAutocomplete: string
  readonly passwordName: string
  readonly passwordType: 'password'
  readonly passwordAutocomplete: string
}

const credentialPairFieldExpectations: Readonly<
  Record<CredentialPairTemplateId, CredentialPairFieldExpectation>
> = {
  'account-number-password': {
    identityName: 'accountNumber',
    identityType: 'text',
    identityAutocomplete: 'username',
    passwordName: 'password',
    passwordType: 'password',
    passwordAutocomplete: 'current-password',
  },
  'dual-identity-password': {
    identityName: 'email',
    identityType: 'email',
    identityAutocomplete: 'username',
    passwordName: 'password',
    passwordType: 'password',
    passwordAutocomplete: 'current-password',
  },
  'employee-id-password': {
    identityName: 'employeeId',
    identityType: 'text',
    identityAutocomplete: 'username',
    passwordName: 'password',
    passwordType: 'password',
    passwordAutocomplete: 'current-password',
  },
  'member-id-password': {
    identityName: 'memberId',
    identityType: 'text',
    identityAutocomplete: 'username',
    passwordName: 'password',
    passwordType: 'password',
    passwordAutocomplete: 'current-password',
  },
  'email-password': {
    identityName: 'email',
    identityType: 'email',
    identityAutocomplete: 'username',
    passwordName: 'password',
    passwordType: 'password',
    passwordAutocomplete: 'current-password',
  },
  'username-password': {
    identityName: 'username',
    identityType: 'text',
    identityAutocomplete: 'username',
    passwordName: 'password',
    passwordType: 'password',
    passwordAutocomplete: 'current-password',
  },
}

const credentialPairTemplateIds: readonly CredentialPairTemplateId[] = [
  'account-number-password',
  'dual-identity-password',
  'employee-id-password',
  'member-id-password',
  'email-password',
  'username-password',
]

test.describe('popular login fixture coverage', () => {
  test.describe.configure({ timeout: 180_000 })

  test('configured catalog sites map to shared templates; CI covers unique shells only', () => {
    expect(catalog).toHaveLength(1000)
    expect(siteShellCount()).toBe(1000)
    expect(templateIds.length).toBeGreaterThan(0)
    expect(templateIds.length).toBeLessThan(100)
    expect(continueWithNookTemplateIds).toHaveLength(templateIds.length - 1)
    expect(failClosedTemplateIds).toEqual(['enterprise-sso-email'])
    const catalogIds = new Set(catalog.map((site) => site.id))
    const mappedSiteIds = new Set(listSiteShellIds())
    for (const catalogEntry of catalog) {
      expect(
        mappedSiteIds.has(catalogEntry.id),
        `catalog site ${catalogEntry.id} has no mock-auth shell`,
      ).toBe(true)
    }
    for (const siteId of listSiteShellIds()) {
      expect(catalogIds.has(siteId)).toBe(true)
      expect(resolveSiteFixture(siteId)?.template).toBeTruthy()
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

  test('audits credential-pair field ownership and successful submission', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Credential pair field audit vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      for (const templateId of credentialPairTemplateIds) {
        const expectation = credentialPairFieldExpectations[templateId]
        const page = await paired.context.newPage()
        await page.goto(`${mockAuth.origin}/template/${templateId}`)

        const identity = page.locator(
          `#login_form [name="${expectation.identityName}"]`,
        )
        const password = page.locator(
          `#login_form [name="${expectation.passwordName}"]`,
        )
        await expect(identity).toHaveAttribute(
          'type',
          expectation.identityType,
        )
        await expect(identity).toHaveAttribute(
          'autocomplete',
          expectation.identityAutocomplete,
        )
        await expect(password).toHaveAttribute(
          'type',
          expectation.passwordType,
        )
        await expect(password).toHaveAttribute(
          'autocomplete',
          expectation.passwordAutocomplete,
        )
        await expect(identity).toHaveValue('')
        await expect(password).toHaveValue('')

        if (templateId === 'dual-identity-password') {
          const phone = page.locator('#login_form [name="phone"]')
          await expect(phone).toHaveAttribute('type', 'tel')
          await expect(phone).toHaveAttribute('autocomplete', 'tel')
          await expect(phone).toHaveValue('')
          await page.evaluate(() => {
            const phone = document.querySelector<HTMLInputElement>(
              '#login_form [name="phone"]',
            )
            if (!(phone instanceof HTMLInputElement)) {
              throw new Error('dual identity phone decoy is missing')
            }
            phone.addEventListener('input', () => {
              sessionStorage.setItem('credential-pair-phone-input', 'touched')
            })
          })
        }

        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible()
        await expect(
          widget.getByRole('button', { name: 'Continue with Nook' }),
        ).toBeVisible()
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.getByTestId('mock-auth-success')).toHaveText(
          'Authentication complete',
          { timeout: 20_000 },
        )
        if (templateId === 'dual-identity-password') {
          await expect
            .poll(() =>
              page.evaluate(
                (key) => sessionStorage.getItem(key) || '',
                'credential-pair-phone-input',
              ),
            )
            .toBe('')
        }
        await page.close()
      }
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('rejects wrong passwords on every credential-pair template', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Credential pair rejection audit vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'wrong-password',
      )

      for (const templateId of credentialPairTemplateIds) {
        const expectation = credentialPairFieldExpectations[templateId]
        const page = await paired.context.newPage()
        await page.goto(`${mockAuth.origin}/template/${templateId}`)
        const identity = page.locator(
          `#login_form [name="${expectation.identityName}"]`,
        )
        const password = page.locator(
          `#login_form [name="${expectation.passwordName}"]`,
        )
        await expect(identity).toHaveAttribute(
          'autocomplete',
          expectation.identityAutocomplete,
        )
        await expect(password).toHaveAttribute(
          'autocomplete',
          expectation.passwordAutocomplete,
        )

        if (templateId === 'dual-identity-password') {
          const phone = page.locator('#login_form [name="phone"]')
          await expect(phone).toHaveValue('')
          await page.evaluate(() => {
            const phone = document.querySelector<HTMLInputElement>(
              '#login_form [name="phone"]',
            )
            if (!(phone instanceof HTMLInputElement)) {
              throw new Error('dual identity phone decoy is missing')
            }
            phone.addEventListener('input', () => {
              sessionStorage.setItem('credential-pair-phone-input', 'touched')
            })
          })
        }

        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible()
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.getByRole('alert')).toHaveText(
          'Invalid username or password.',
          { timeout: 20_000 },
        )
        await expect(page.getByTestId('mock-auth-success')).toHaveCount(0)
        if (templateId === 'dual-identity-password') {
          await expect
            .poll(() =>
              page.evaluate(
                (key) => sessionStorage.getItem(key) || '',
                'credential-pair-phone-input',
              ),
            )
            .toBe('')
        }
        await page.close()
      }
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('progresses identifier-first templates through success and wrong-password evidence', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Popular identifier-first templates vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      for (const templateId of [
        'email-first',
        'username-first',
        'google',
        'microsoft',
        'slack',
      ]) {
        const page = await paired.context.newPage()
        await page.goto(`${mockAuth.origin}/template/${templateId}`)
        const widget = page.locator('#nook-auth-widget')
        await expect(widget.getByText('Ready to sign in')).toBeVisible()
        await widget.getByRole('button', { name: 'Continue with Nook' }).click()
        await expect(page.locator('input[type="password"]')).toBeVisible()
        await expect(page.getByTestId('mock-auth-success')).toHaveCount(0)
        if (templateId === 'google') {
          await expect(page.getByTestId('google-selected-account')).toHaveText(
            'alice@nook.test',
          )
          await expect(page.locator('[name="identifier"]')).toHaveCount(0)
        }

        await expect(widget.getByText('Ready to sign in')).toBeVisible()
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

  test('does not report success for a wrong password on identifier-first templates', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Popular identifier-first wrong-password vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'wrong-password',
      )

      const page = await paired.context.newPage()
      await page.goto(`${mockAuth.origin}/template/google`)
      const widget = page.locator('#nook-auth-widget')
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(page.locator('input[type="password"]')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(page.getByRole('alert')).toHaveText(
        'Invalid username or password.',
      )
      await expect(page.getByTestId('mock-auth-success')).toHaveCount(0)
      await page.close()
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
