import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import {
  FormSubmissionResult,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { SiteFixturePilotExpectation } from '../../../../nook-web-extension/e2e/mock-auth/src/lib/site-fixtures'
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
const fixturesRoot = path.resolve(
  here,
  '../../../../nook-web-extension/e2e/mock-auth/fixtures',
)
const templatesDir = path.join(fixturesRoot, 'templates')
const siteShellsPath = path.join(fixturesRoot, 'site-shells.json')
const pilotExpectationsPath = path.join(fixturesRoot, 'pilot-expectations.json')

type SiteFixtureField = {
  name?: string
  type?: string
  id?: string
  autocomplete?: string
  placeholder?: string
  'aria-label'?: string
  'data-qa'?: string
  'data-testid'?: string
}

type ShellTemplate = {
  id: string
  quirks: string[]
  steps: Array<{
    fields: SiteFixtureField[]
    submit: { type?: string; label: string; name?: string; id?: string }
  }>
}

type CatalogEntry = { id: string; rank: number }
type SiteShellRef = {
  template: string
  source: string
  loginUrl: string
}

const siteShells = JSON.parse(readFileSync(siteShellsPath, 'utf8')) as Record<
  string,
  SiteShellRef
>
const pilotExpectations = JSON.parse(
  readFileSync(pilotExpectationsPath, 'utf8'),
) as Record<string, SiteFixturePilotExpectation>
const templates = new Map(
  readdirSync(templatesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const id = name.replace(/\.json$/u, '')
      const template = JSON.parse(
        readFileSync(path.join(templatesDir, name), 'utf8'),
      ) as ShellTemplate
      return [id, { ...template, id }] as const
    }),
)

function escapeAttr(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')
}

function renderStepHtml(fixture: ShellTemplate, stepIndex: number): string {
  const [step = fixture.steps[0]] = [fixture.steps[stepIndex]]
  const fields = step.fields
    .map((field) => {
      const attrs = [
        `type="${escapeAttr(((...[v = 'text']) => v)(field.type))}"`,
        field.name ? `name="${escapeAttr(field.name)}"` : '',
        field.id ? `id="${escapeAttr(field.id)}"` : '',
        field.autocomplete
          ? `autocomplete="${escapeAttr(field.autocomplete)}"`
          : '',
        field.placeholder
          ? `placeholder="${escapeAttr(field.placeholder)}"`
          : '',
        field['aria-label']
          ? `aria-label="${escapeAttr(field['aria-label'])}"`
          : '',
        field['data-qa'] ? `data-qa="${escapeAttr(field['data-qa'])}"` : '',
        field['data-testid']
          ? `data-testid="${escapeAttr(field['data-testid'])}"`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
      return `<input ${attrs} />`
    })
    .join('')
  const submitType = step.submit.type === 'button' ? 'button' : 'submit'
  const inner = `<form id="login_form" method="post" action="/auth/login">${fields}<button type="${submitType}">${step.submit.label}</button></form>`
  return fixture.quirks.includes('aria-hidden-ancestor')
    ? `<div aria-hidden="true">${inner}</div>`
    : inner
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('popular login shell templates', () => {
  const catalog = JSON.parse(
    readFileSync(catalogPath, 'utf8'),
  ) as CatalogEntry[]
  const templateIds = [...templates.keys()].sort()

  test('catalog maps every site to a shared template (no per-site shell copies)', () => {
    expect(catalog).toHaveLength(1000)
    expect(Object.keys(siteShells)).toHaveLength(1000)
    expect(templates.size).toBeGreaterThan(0)
    expect(templates.size).toBeLessThan(catalog.length)
    expect(Object.keys(pilotExpectations).sort()).toEqual(templateIds)
    expect(
      Object.values(pilotExpectations).filter(
        (expectation) =>
          expectation ===
          SiteFixturePilotExpectation.FailClosedAlternateAuthentication,
      ),
    ).toEqual([SiteFixturePilotExpectation.FailClosedAlternateAuthentication])
    for (const site of catalog) {
      expect(siteShells[site.id]).toBeTruthy()
      expect(templates.has(siteShells[site.id].template)).toBe(true)
    }
  })

  test.each(templateIds.map((id) => [id, id]))(
    'detects login workflow for template %s',
    (templateId) => {
      const fixture = templates.get(templateId) as ShellTemplate
      expect(fixture.steps.length).toBeGreaterThan(0)

      const firstHasPassword = fixture.steps[0].fields.some(
        (field) => field.type === 'password',
      )
      document.body.innerHTML = renderStepHtml(fixture, 0)
      const observations = summarizeAuthenticationWorkflowForms()
      expect(observations.length).toBeGreaterThan(0)
      const summary = observations[0]?.summary
      expect(summary).toBeTruthy()
      const authSignal =
        ((v) => (v ? v : 0))(summary?.usernameFieldCount) +
        ((v) => (v ? v : 0))(summary?.passwordFieldCount) +
        ((v) => (v ? v : 0))(summary?.oneTimeCodeFieldCount)
      expect(authSignal).toBeGreaterThan(0)

      if (!firstHasPassword && fixture.steps.length > 1) {
        document.body.innerHTML = renderStepHtml(
          fixture,
          fixture.steps.length - 1,
        )
        const passwordObservations = summarizeAuthenticationWorkflowForms()
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
    const fixture = templates.get(templateId)
    if (!fixture) throw new Error('enterprise SSO fixture is missing')
    expect(pilotExpectations[templateId]).toBe(
      SiteFixturePilotExpectation.FailClosedAlternateAuthentication,
    )

    const credentials: FakeLoginCredentials = {
      username: 'enterprise-sso-user@example.test',
      password: 'enterprise-sso-password',
    }
    const request: DomAuthenticationSimulationRequest = {
      fixture: { html: renderStepHtml(fixture, 0) },
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
