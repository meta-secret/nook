import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { summarizeAuthenticationWorkflowForms } from '../../../../nook-web-shared/src/extension/password-forms'

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogPath = path.resolve(
  here,
  '../../../../../nook-core/data/popular_login_sites.json',
)
const fixturesRoot = path.resolve(
  here,
  '../../../../nook-web-extension/e2e/mock-auth/fixtures',
)
const templatesDir = path.join(fixturesRoot, 'templates')
const siteShellsPath = path.join(fixturesRoot, 'site-shells.json')

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

type SiteFixture = {
  id: string
  quirks: string[]
  steps: Array<{
    fields: SiteFixtureField[]
    submit: { type?: string; label: string; name?: string; id?: string }
  }>
  template: string
}

type CatalogEntry = { id: string; rank: number }
type SiteShellRef = {
  template: string
  source: string
  loginUrl: string
  quirks?: string[]
  steps?: SiteFixture['steps']
}

const siteShells = JSON.parse(readFileSync(siteShellsPath, 'utf8')) as Record<
  string,
  SiteShellRef
>
const templates = new Map(
  readdirSync(templatesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const id = name.replace(/\.json$/u, '')
      const template = JSON.parse(
        readFileSync(path.join(templatesDir, name), 'utf8'),
      ) as { quirks: string[]; steps: SiteFixture['steps'] }
      return [id, template] as const
    }),
)

function resolveSiteFixture(id: string): SiteFixture | undefined {
  const ref = siteShells[id]
  if (!ref) return undefined
  const template = templates.get(ref.template)
  const steps = ref.steps ?? template?.steps
  if (!steps || steps.length === 0) return undefined
  return {
    id,
    quirks: ref.quirks ?? template?.quirks ?? [],
    steps,
    template: ref.template,
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')
}

function renderStepHtml(fixture: SiteFixture, stepIndex: number): string {
  const step = fixture.steps[stepIndex] ?? fixture.steps[0]
  const fields = step.fields
    .map((field) => {
      const attrs = [
        `type="${escapeAttr(field.type ?? 'text')}"`,
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
  const inner = `<form>${fields}<button type="${submitType}">${step.submit.label}</button></form>`
  return fixture.quirks.includes('aria-hidden-ancestor')
    ? `<div aria-hidden="true">${inner}</div>`
    : inner
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('popular login site fixtures', () => {
  const catalog = JSON.parse(
    readFileSync(catalogPath, 'utf8'),
  ) as CatalogEntry[]

  test('catalog has exactly 100 sites mapped to shared shell templates', () => {
    expect(catalog).toHaveLength(100)
    expect(Object.keys(siteShells)).toHaveLength(100)
    expect(templates.size).toBeGreaterThan(0)
    expect(templates.size).toBeLessThan(catalog.length)
    for (const site of catalog) {
      expect(siteShells[site.id]).toBeTruthy()
      expect(resolveSiteFixture(site.id)).toBeTruthy()
      expect(templates.has(siteShells[site.id].template)).toBe(true)
    }
  })

  test.each(catalog.map((site) => [site.id, site.id]))(
    'detects login workflow for %s',
    (siteId) => {
      const fixture = resolveSiteFixture(siteId) as SiteFixture
      expect(fixture.id).toBe(siteId)
      expect(fixture.steps.length).toBeGreaterThan(0)

      const firstStep = fixture.steps[0]
      const firstHasPassword = firstStep.fields.some(
        (field) => field.type === 'password',
      )
      document.body.innerHTML = renderStepHtml(fixture, 0)
      const observations = summarizeAuthenticationWorkflowForms()
      expect(observations.length).toBeGreaterThan(0)
      const summary = observations[0]?.summary
      expect(summary).toBeTruthy()
      const authSignal =
        (summary?.usernameFieldCount ?? 0) +
        (summary?.passwordFieldCount ?? 0) +
        (summary?.oneTimeCodeFieldCount ?? 0)
      expect(authSignal).toBeGreaterThan(0)

      if (!firstHasPassword && fixture.steps.length > 1) {
        document.body.innerHTML = renderStepHtml(
          fixture,
          fixture.steps.length - 1,
        )
        const passwordObservations = summarizeAuthenticationWorkflowForms()
        expect(passwordObservations.length).toBeGreaterThan(0)
        expect(
          passwordObservations[0]?.summary.passwordFieldCount ?? 0,
        ).toBeGreaterThan(0)
      }
    },
  )
})
