import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import {
  FormSubmissionResult,
  passwordFormInteraction,
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
  inputmode?: string
  label?: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    Object(value) === value &&
    !Array.isArray(value)
  )
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isOptionalString(
  record: Record<string, unknown>,
  key: string,
): boolean {
  return !(key in record) || isString(record[key])
}

function isRecordOf<T>(
  value: unknown,
  guard: (entry: unknown) => entry is T,
): value is Record<string, T> {
  return isRecord(value) && Object.values(value).every(guard)
}

function isSiteShellRef(value: unknown): value is SiteShellRef {
  return (
    isRecord(value) &&
    isString(value.template) &&
    isString(value.source) &&
    isString(value.loginUrl)
  )
}

function isSiteFixtureField(value: unknown): value is SiteFixtureField {
  return (
    isRecord(value) &&
    isOptionalString(value, 'name') &&
    isOptionalString(value, 'type') &&
    isOptionalString(value, 'id') &&
    isOptionalString(value, 'autocomplete') &&
    isOptionalString(value, 'inputmode') &&
    isOptionalString(value, 'label') &&
    isOptionalString(value, 'placeholder') &&
    isOptionalString(value, 'aria-label') &&
    isOptionalString(value, 'data-qa') &&
    isOptionalString(value, 'data-testid')
  )
}

function isShellTemplate(value: unknown): value is ShellTemplate {
  if (!isRecord(value) || !isString(value.id)) return false
  if (
    !Array.isArray(value.quirks) ||
    !value.quirks.every(isString) ||
    !Array.isArray(value.steps)
  ) {
    return false
  }
  return value.steps.every((step) => {
    if (
      !isRecord(step) ||
      !Array.isArray(step.fields) ||
      !isRecord(step.submit)
    ) {
      return false
    }
    return (
      step.fields.every(isSiteFixtureField) &&
      isString(step.submit.label) &&
      isOptionalString(step.submit, 'type') &&
      isOptionalString(step.submit, 'name') &&
      isOptionalString(step.submit, 'id')
    )
  })
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  return isRecord(value) && isString(value.id) && typeof value.rank === 'number'
}

function isPilotExpectation(
  value: unknown,
): value is SiteFixturePilotExpectation {
  return Object.values(SiteFixturePilotExpectation).some(
    (expectation) => expectation === value,
  )
}

function readJson<T>(
  filePath: string,
  guard: (value: unknown) => value is T,
): T {
  const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  if (!guard(value)) throw new Error(`invalid fixture JSON: ${filePath}`)
  return value
}

const siteShells = readJson(
  siteShellsPath,
  (value): value is Record<string, SiteShellRef> =>
    isRecordOf(value, isSiteShellRef),
)
const pilotExpectations = readJson(
  pilotExpectationsPath,
  (value): value is Record<string, SiteFixturePilotExpectation> =>
    isRecordOf(value, isPilotExpectation),
)
const templates = new Map(
  readdirSync(templatesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const id = name.replace(/\.json$/u, '')
      const template = readJson(path.join(templatesDir, name), isShellTemplate)
      return [id, { ...template, id }]
    }),
)

function escapeAttr(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')
}

function renderStepHtml(fixture: ShellTemplate, stepIndex: number): string {
  let step = fixture.steps[stepIndex]
  if (!step) [step] = fixture.steps
  if (!step) expect.fail('a shell fixture must contain at least one step')
  const fields = step.fields
    .map((field) => {
      const attrs = [
        `type="${escapeAttr(((...[v = 'text']) => v)(field.type))}"`,
        field.name ? `name="${escapeAttr(field.name)}"` : '',
        field.id ? `id="${escapeAttr(field.id)}"` : '',
        field.autocomplete
          ? `autocomplete="${escapeAttr(field.autocomplete)}"`
          : '',
        field.inputmode ? `inputmode="${escapeAttr(field.inputmode)}"` : '',
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
      const input = `<input ${attrs} />`
      if (!field.label) return input
      const label = field.label
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
      return `<label>${label}${input}</label>`
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
  const catalog = readJson(
    catalogPath,
    (value): value is CatalogEntry[] =>
      Array.isArray(value) && value.every(isCatalogEntry),
  )
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
      const siteShell = siteShells[site.id]
      if (!siteShell) expect.fail(`missing shell for catalog site ${site.id}`)
      expect(templates.has(siteShell.template)).toBe(true)
    }
  })

  test.each(templateIds.map((id) => [id, id]))(
    'detects login workflow for template %s',
    (templateId) => {
      const fixture = templates.get(templateId)
      if (!fixture) expect.fail(`missing template ${templateId}`)
      expect(fixture.steps.length).toBeGreaterThan(0)

      const [firstStep] = fixture.steps
      if (!firstStep) expect.fail('a shell fixture must contain a first step')
      const firstHasPassword = firstStep.fields.some(
        (field) => field.type === 'password',
      )
      document.body.innerHTML = renderStepHtml(fixture, 0)
      const observations =
        passwordFormInteraction.summarizeAuthenticationWorkflowForms()
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
