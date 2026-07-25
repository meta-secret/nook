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
const fixturesDir = path.resolve(
  here,
  '../../../../nook-web-extension/e2e/mock-auth/fixtures/sites',
)

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
  source: string
  quirks: string[]
  steps: Array<{
    fields: SiteFixtureField[]
    submit: { type?: string; label: string; name?: string; id?: string }
  }>
}

type CatalogEntry = { id: string; rank: number }

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
  const fixtureFiles = readdirSync(fixturesDir).filter((name) =>
    name.endsWith('.json'),
  )

  test('catalog has exactly 100 sites and every id has a fixture file', () => {
    expect(catalog).toHaveLength(100)
    expect(fixtureFiles).toHaveLength(100)
    for (const site of catalog) {
      expect(fixtureFiles).toContain(`${site.id}.json`)
    }
  })

  test.each(catalog.map((site) => [site.id, site.id]))(
    'detects login workflow for %s',
    (siteId) => {
      const fixture = JSON.parse(
        readFileSync(path.join(fixturesDir, `${siteId}.json`), 'utf8'),
      ) as SiteFixture
      expect(fixture.id).toBe(siteId)
      expect(fixture.steps.length).toBeGreaterThan(0)

      // Username-first shells: assert first step; password shells: final step.
      const firstStep = fixture.steps[0]
      const firstHasPassword = firstStep.fields.some(
        (field) => field.type === 'password',
      )
      const stepIndex = firstHasPassword ? 0 : 0
      document.body.innerHTML = renderStepHtml(fixture, stepIndex)
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
