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

export enum SiteFixtureSubmitType {
  Button = 'button',
  Submit = 'submit',
}

export type SiteFixtureSubmit = {
  type: SiteFixtureSubmitType
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

export enum SiteFixtureLookupKind {
  Missing = 'missing',
  Found = 'found',
}

export type SiteFixtureLookup =
  | { kind: SiteFixtureLookupKind.Missing }
  | { kind: SiteFixtureLookupKind.Found; fixture: SiteFixture }

export enum ShellTemplateLookupKind {
  Missing = 'missing',
  Found = 'found',
}

export type ShellTemplateLookup =
  | { kind: ShellTemplateLookupKind.Missing }
  | { kind: ShellTemplateLookupKind.Found; template: ShellTemplate }

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

function resolveSiteFixture(id: string): SiteFixtureLookup {
  const ref = siteShells[id]
  if (!ref) return { kind: SiteFixtureLookupKind.Missing }
  const template = templatesById.get(ref.template)
  const [steps = template?.steps] = [ref.steps]
  if (!steps || steps.length === 0) {
    return { kind: SiteFixtureLookupKind.Missing }
  }
  return {
    kind: SiteFixtureLookupKind.Found,
    fixture: {
      id,
      source: ref.source,
      loginUrl: ref.loginUrl,
      quirks: ((v) => (v ? v : []))(
        ((...[v = template?.quirks]) => v)(ref.quirks),
      ),
      steps,
      template: ref.template,
    },
  }
}

const fixturesById = new Map<string, SiteFixture>()
for (const id of Object.keys(siteShells)) {
  const fixture = resolveSiteFixture(id)
  if (fixture.kind === SiteFixtureLookupKind.Found) {
    fixturesById.set(id, fixture.fixture)
  }
}

export function listSiteFixtureIds(): string[] {
  return [...fixturesById.keys()].sort()
}

export function listShellTemplateIds(): string[] {
  return [...templatesById.keys()].sort()
}

export function getSiteFixture(id: string): SiteFixtureLookup {
  const fixture = fixturesById.get(id)
  return fixture
    ? { kind: SiteFixtureLookupKind.Found, fixture }
    : { kind: SiteFixtureLookupKind.Missing }
}

export function getShellTemplate(id: string): ShellTemplateLookup {
  const template = templatesById.get(id)
  return template
    ? { kind: ShellTemplateLookupKind.Found, template }
    : { kind: ShellTemplateLookupKind.Missing }
}

/** Render a shared template as a fixture (CI exercises unique shells, not every catalog id). */
export function getTemplateFixture(templateId: string): SiteFixtureLookup {
  const template = templatesById.get(templateId)
  if (!template || template.steps.length === 0) {
    return { kind: SiteFixtureLookupKind.Missing }
  }
  return {
    kind: SiteFixtureLookupKind.Found,
    fixture: {
      id: templateId,
      source: SiteFixtureSource.Research,
      loginUrl: `https://template.invalid/${templateId}`,
      quirks: ((v) => (v ? v : []))(template.quirks),
      steps: template.steps,
      template: templateId,
    },
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
  const [stepIndex = Math.max(0, fixture.steps.length - 1)] = [
    options?.stepIndex,
  ]
  const [step = fixture.steps[0]] = [fixture.steps[stepIndex]]
  const [ariaHidden = fixture.quirks.includes('aria-hidden-ancestor')] = [
    options?.wrapAriaHidden,
  ]
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
  const submitType =
    step.submit.type === SiteFixtureSubmitType.Button
      ? SiteFixtureSubmitType.Button
      : SiteFixtureSubmitType.Submit
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
