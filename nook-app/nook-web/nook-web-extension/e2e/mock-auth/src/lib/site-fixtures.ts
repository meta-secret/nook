import siteShellsJson from '../../fixtures/site-shells.json'

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
  source: SiteFixtureSource
  loginUrl: string
  quirks: string[]
  steps: SiteFixtureStep[]
  template: string
}

enum SiteFixtureSource {
  Capture = 'capture',
  Research = 'research',
}

export type PopularLoginSite = {
  id: string
  name: string
  family: string
  loginUrl: string
  hosts: string[]
  rank: number
}

type ShellTemplate = {
  id: string
  quirks: string[]
  steps: SiteFixtureStep[]
}

type SiteShellRef = {
  template: string
  source: SiteFixtureSource
  loginUrl: string
  quirks?: string[]
  steps?: SiteFixtureStep[]
}

const siteShells = siteShellsJson as Record<string, SiteShellRef>

const templateModules = import.meta.glob('../../fixtures/templates/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, ShellTemplate>

const templatesById = new Map<string, ShellTemplate>()
for (const [pathKey, template] of Object.entries(templateModules)) {
  const id = pathKey
    .split('/')
    .pop()
    ?.replace(/\.json$/u, '')
  if (!id || !template || typeof template !== 'object') continue
  templatesById.set(id, { ...template, id })
}

function resolveSiteFixture(id: string): SiteFixture | void {
  const ref = siteShells[id]
  if (!ref) return
  const template = templatesById.get(ref.template)
  const steps = ref.steps ?? template?.steps
  if (!steps || steps.length === 0) return
  return {
    id,
    source: ref.source,
    loginUrl: ref.loginUrl,
    quirks: ref.quirks ?? template?.quirks ?? [],
    steps,
    template: ref.template,
  }
}

const fixturesById = new Map<string, SiteFixture>()
for (const id of Object.keys(siteShells)) {
  const fixture = resolveSiteFixture(id)
  if (fixture) fixturesById.set(id, fixture)
}

export function listSiteFixtureIds(): string[] {
  return [...fixturesById.keys()].sort()
}

export function listShellTemplateIds(): string[] {
  return [...templatesById.keys()].sort()
}

export function getSiteFixture(id: string): SiteFixture | void {
  return fixturesById.get(id)
}

export function getShellTemplate(id: string): ShellTemplate | void {
  return templatesById.get(id)
}

/** Render a shared template as a fixture (CI exercises unique shells, not every catalog id). */
export function getTemplateFixture(templateId: string): SiteFixture | void {
  const template = templatesById.get(templateId)
  if (!template || template.steps.length === 0) return
  return {
    id: templateId,
    source: 'research',
    loginUrl: `https://template.invalid/${templateId}`,
    quirks: template.quirks ?? [],
    steps: template.steps,
    template: templateId,
  }
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
