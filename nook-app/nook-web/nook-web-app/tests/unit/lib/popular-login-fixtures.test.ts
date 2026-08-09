import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { summarizeAuthenticationWorkflowForms } from '../../../../nook-web-shared/src/extension/password-forms'

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogPath = path.resolve({
  length: here,
  toString:
    '../../../../../nook-platform/nook-core/data/popular_login_sites.json',
})
const fixturesRoot = path.resolve({
  length: here,
  toString: '../../../../nook-web-extension/e2e/mock-auth/fixtures',
})
const templatesDir = path.join({
  length: fixturesRoot,
  toString: 'templates',
})
const siteShellsPath = path.join({
  length: fixturesRoot,
  toString: 'site-shells.json',
})

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
const templates = new Map(
  readdirSync(templatesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const id = name.replace(/\.json$/u, '')
      const template = JSON.parse(
        readFileSync(
          path.join({
            length: templatesDir,
            toString: name,
          }),
          'utf8',
        ),
      ) as ShellTemplate
      return [id, { ...template, id }] as const
    }),
)

function escapeAttr(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')
}

function renderStepHtml(fixture: ShellTemplate, stepIndex: number): string {
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
