import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import {
  FormSubmissionResult,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  getSiteFixture,
  getShellTemplate,
  getTemplateFixture,
  listShellTemplateIds,
  listSiteFixtureIds,
  renderFixtureHtml,
  SiteFixtureLookupKind,
  SiteFixturePilotExpectation,
  ShellTemplateLookupKind,
  type SiteFixture,
} from '../../../../nook-web-extension/e2e/mock-auth/src/lib/site-fixtures'
import {
  DomAuthenticationSimulationOutcomeKind,
  simulateDomAuthentication,
  type DomAuthenticationSimulationRequest,
} from './companion-dom-authentication-simulation'
import type { FakeLoginCredentials } from './companion-credential-fill-simulation'

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogPath = path.resolve(
  here,
  '../../../../../nook-platform/nook-core/data/popular_login_sites.json',
)
type CatalogEntry = { id: string; rank: number }

class PopularLoginCatalogDecoder {
  decode(value: unknown): CatalogEntry[] {
    if (!Array.isArray(value)) {
      throw new TypeError('popular login catalog has an invalid shape')
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
      typeof value.id !== 'string' ||
      !('rank' in value) ||
      typeof value.rank !== 'number'
    ) {
      throw new TypeError('popular login catalog entry has an invalid shape')
    }
    return { id: value.id, rank: value.rank }
  }
}

class PopularLoginShellFixtureCatalog {
  readonly templateIds = listShellTemplateIds()
  readonly siteIds = listSiteFixtureIds()

  template(templateId: string): SiteFixture {
    const decodedTemplate = getTemplateFixture(templateId)
    if (decodedTemplate.kind !== SiteFixtureLookupKind.Found) {
      throw new Error(`shell template ${templateId} is missing`)
    }
    return decodedTemplate.fixture
  }

  pilotExpectation(templateId: string): SiteFixturePilotExpectation {
    const decodedTemplate = getShellTemplate(templateId)
    if (decodedTemplate.kind !== ShellTemplateLookupKind.Found) {
      throw new Error(`shell template ${templateId} is missing`)
    }
    return decodedTemplate.template.pilotExpectation
  }

  renderStep(fixture: SiteFixture, stepIndex: number): string {
    return renderFixtureHtml(fixture, { stepIndex })
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('popular login shell templates', () => {
  const catalogValue: unknown = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const catalog = new PopularLoginCatalogDecoder().decode(catalogValue)
  const fixtureCatalog = new PopularLoginShellFixtureCatalog()
  const templateIds = [...fixtureCatalog.templateIds].sort()

  test('configured sites map to shared catalog templates (no per-site shell copies)', () => {
    expect(catalog).toHaveLength(1000)
    expect(fixtureCatalog.siteIds).toHaveLength(1000)
    expect(templateIds.length).toBeGreaterThan(0)
    expect(templateIds.length).toBeLessThan(catalog.length)
    expect(
      templateIds.filter(
        (templateId) =>
          fixtureCatalog.pilotExpectation(templateId) ===
          SiteFixturePilotExpectation.FailClosedAlternateAuthentication,
      ),
    ).toEqual(['email-password-aria-hidden', 'enterprise-sso-email'])
    const catalogIds = new Set(catalog.map((site) => site.id))
    for (const siteId of fixtureCatalog.siteIds) {
      expect(catalogIds.has(siteId)).toBe(true)
      const site = getSiteFixture(siteId)
      if (site.kind !== SiteFixtureLookupKind.Found) {
        throw new Error(`site fixture ${siteId} is missing`)
      }
      expect(templateIds).toContain(site.fixture.template)
    }
  })

  test('renders Booking hidden-password layout and omitted form attributes', () => {
    const html = renderFixtureHtml(fixtureCatalog.template('booking'))
    expect(html).toContain(
      '<div style="height: 0; overflow: hidden"><input type="password"',
    )
    expect(html).toContain('<form class="nw-signin">')
    expect(html).not.toContain('method="post"')
    expect(html).not.toContain('action="/auth/login"')
  })

  test.each(templateIds.map((id) => [id, id]))(
    'detects login workflow for template %s',
    (templateId) => {
      const fixture = fixtureCatalog.template(templateId)
      expect(fixture.steps.length).toBeGreaterThan(0)

      const [firstStep] = fixture.steps
      if (!firstStep) expect.fail('a shell fixture must contain a first step')
      const firstHasPassword = firstStep.fields.some(
        (field) => field.type === 'password',
      )
      document.body.innerHTML = fixtureCatalog.renderStep(fixture, 0)
      const observations =
        passwordFormInteraction.summarizeAuthenticationWorkflowForms()
      if (
        fixtureCatalog.pilotExpectation(templateId) ===
          SiteFixturePilotExpectation.FailClosedAlternateAuthentication &&
        templateId === 'email-password-aria-hidden'
      ) {
        expect(observations).toHaveLength(0)
        return
      }
      expect(observations.length).toBeGreaterThan(0)
      const summary = observations[0]?.summary
      expect(summary).toBeTruthy()
      const authSignal =
        ((v) => (v ? v : 0))(summary?.usernameFieldCount) +
        ((v) => (v ? v : 0))(summary?.passwordFieldCount) +
        ((v) => (v ? v : 0))(summary?.oneTimeCodeFieldCount)
      expect(authSignal).toBeGreaterThan(0)

      if (!firstHasPassword && fixture.steps.length > 1) {
        document.body.innerHTML = fixtureCatalog.renderStep(
          fixture,
          fixture.steps.length - 1,
        )
        const passwordObservations =
          passwordFormInteraction.summarizeAuthenticationWorkflowForms()
        expect(passwordObservations.length).toBeGreaterThan(0)
        expect(
          ((v) => (v ? v : 0))(
            passwordObservations[0]?.summary.passwordFieldCount,
          ),
        ).toBeGreaterThan(0)
      }
    },
  )

  test('keeps the enterprise SSO identifier shell fail closed', () => {
    const templateId = 'enterprise-sso-email'
    const fixture = fixtureCatalog.template(templateId)
    expect(fixtureCatalog.pilotExpectation(templateId)).toBe(
      SiteFixturePilotExpectation.FailClosedAlternateAuthentication,
    )

    const credentials: FakeLoginCredentials = {
      username: 'enterprise-sso-user@example.test',
      password: 'enterprise-sso-password',
    }
    const request: DomAuthenticationSimulationRequest = {
      fixture: { html: fixtureCatalog.renderStep(fixture, 0) },
      credentials,
    }
    const result = simulateDomAuthentication(request)
    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      observationCount: 1,
      workflowAction: false,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
      submittedControlIdentity: '',
    })
    const email = document.querySelector<HTMLInputElement>('[name="email"]')
    if (!email) throw new Error('enterprise SSO email field is missing')
    expect(email.value).toBe('')
  })
})
