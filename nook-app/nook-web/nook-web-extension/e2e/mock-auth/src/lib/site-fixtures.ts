export type SiteFixtureField = {
  name?: string
  type?: string
  id?: string
  autocomplete?: string
  placeholder?: string
  'aria-label'?: string
  'data-qa'?: string
  'data-testid'?: string
}

export type SiteFixtureSubmit = {
  type?: string
  name?: string
  id?: string
  label: string
  'data-qa'?: string
}

export type SiteFixtureStep = {
  fields: SiteFixtureField[]
  submit: SiteFixtureSubmit
}

export type SiteFixture = {
  id: string
  source: 'capture' | 'research'
  loginUrl: string
  quirks: string[]
  steps: SiteFixtureStep[]
}

export type PopularLoginSite = {
  id: string
  name: string
  family: string
  loginUrl: string
  hosts: string[]
  rank: number
}

const fixtureModules = import.meta.glob('../../fixtures/sites/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, SiteFixture>

const fixturesById = new Map<string, SiteFixture>()
for (const [pathKey, fixture] of Object.entries(fixtureModules)) {
  const id = pathKey
    .split('/')
    .pop()
    ?.replace(/\.json$/u, '')
  if (!id || !fixture || typeof fixture !== 'object') continue
  fixturesById.set(id, { ...fixture, id })
}

export function listSiteFixtureIds(): string[] {
  return [...fixturesById.keys()].sort()
}

export function getSiteFixture(id: string): SiteFixture | undefined {
  return fixturesById.get(id)
}

export function isSiteFixture(value: unknown): value is SiteFixture {
  if (!value || typeof value !== 'object') return false
  const fixture = value as SiteFixture
  return (
    typeof fixture.id === 'string' &&
    (fixture.source === 'capture' || fixture.source === 'research') &&
    typeof fixture.loginUrl === 'string' &&
    Array.isArray(fixture.quirks) &&
    Array.isArray(fixture.steps) &&
    fixture.steps.length > 0 &&
    fixture.steps.every(
      (step) =>
        Array.isArray(step.fields) &&
        step.fields.length > 0 &&
        step.submit &&
        typeof step.submit.label === 'string',
    )
  )
}

/** Build static HTML for unit tests (first step, or final step for password shells). */
export function renderFixtureHtml(
  fixture: SiteFixture,
  options?: { stepIndex?: number; wrapAriaHidden?: boolean },
): string {
  const stepIndex = options?.stepIndex ?? Math.max(0, fixture.steps.length - 1)
  const step = fixture.steps[stepIndex] ?? fixture.steps[0]
  const ariaHidden =
    options?.wrapAriaHidden ?? fixture.quirks.includes('aria-hidden-ancestor')
  const fields = step.fields
    .map((field) => {
      const attrs = [
        field.type ? `type="${escapeAttr(field.type)}"` : 'type="text"',
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
    .join('\n')
  const submitType = step.submit.type === 'button' ? 'button' : 'submit'
  const submitAttrs = [
    `type="${submitType}"`,
    step.submit.name ? `name="${escapeAttr(step.submit.name)}"` : '',
    step.submit.id ? `id="${escapeAttr(step.submit.id)}"` : '',
    step.submit['data-qa']
      ? `data-qa="${escapeAttr(step.submit['data-qa'])}"`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  const inner = `
    <form id="login_form">
      ${fields}
      <button ${submitAttrs}>${escapeHtml(step.submit.label)}</button>
    </form>`
  return ariaHidden ? `<div aria-hidden="true">${inner}</div>` : inner
}

function escapeAttr(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}
