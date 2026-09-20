import siteShellsJson from '../../fixtures/site-shells.json'
import pilotExpectationsJson from '../../fixtures/pilot-expectations.json'

export enum SiteFixtureInputMode {
  Email = 'email',
}

export type SiteFixtureField = {
  name?: string
  type?: string
  id?: string
  autocomplete?: string
  inputmode?: SiteFixtureInputMode
  label?: string
  placeholder?: string
  'aria-label'?: string
  'aria-hidden'?: string
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
  class?: string
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

export enum SiteFixturePilotExpectation {
  ContinueWithNook = 'continue-with-nook',
  FailClosedAlternateAuthentication = 'fail-closed-alternate-authentication',
}

export enum SiteFixtureSource {
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

export type ShellTemplate = {
  id: string
  quirks: string[]
  steps: SiteFixtureStep[]
  pilotExpectation: SiteFixturePilotExpectation
}

type ShellTemplateRaw = Omit<ShellTemplate, 'id' | 'pilotExpectation'>

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

class SiteFixtureCatalogAdmission {
  decodeSiteShellRef(value: unknown): SiteShellRef {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('template' in value) ||
      typeof value.template !== 'string' ||
      !('source' in value) ||
      (value.source !== SiteFixtureSource.Capture &&
        value.source !== SiteFixtureSource.Research) ||
      !('loginUrl' in value) ||
      typeof value.loginUrl !== 'string'
    ) {
      throw new TypeError('site shell reference has an invalid shape')
    }
    const reference: SiteShellRef = {
      template: value.template,
      source: value.source,
      loginUrl: value.loginUrl,
    }
    if ('quirks' in value) {
      reference.quirks = this.decodeStringList(value.quirks)
    }
    if ('steps' in value) {
      reference.steps = this.decodeSteps(value.steps)
    }
    return reference
  }

  decodePilotExpectation(value: unknown): SiteFixturePilotExpectation {
    switch (value) {
      case SiteFixturePilotExpectation.ContinueWithNook:
        return SiteFixturePilotExpectation.ContinueWithNook
      case SiteFixturePilotExpectation.FailClosedAlternateAuthentication:
        return SiteFixturePilotExpectation.FailClosedAlternateAuthentication
      default:
        throw new TypeError('shell template has an invalid Pilot expectation')
    }
  }

  decodeShellTemplateRaw(value: unknown): ShellTemplateRaw {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('quirks' in value) ||
      !('steps' in value)
    ) {
      throw new TypeError('shell template has an invalid shape')
    }
    return {
      quirks: this.decodeStringList(value.quirks),
      steps: this.decodeSteps(value.steps),
    }
  }

  decodeSiteFixture(value: unknown): SiteFixture {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !('source' in value) ||
      (value.source !== SiteFixtureSource.Capture &&
        value.source !== SiteFixtureSource.Research) ||
      !('loginUrl' in value) ||
      typeof value.loginUrl !== 'string' ||
      !('quirks' in value) ||
      !('steps' in value) ||
      !('template' in value) ||
      typeof value.template !== 'string'
    ) {
      throw new TypeError('site fixture has an invalid shape')
    }
    const steps = this.decodeSteps(value.steps)
    if (steps.length === 0) {
      throw new TypeError('site fixture must contain at least one step')
    }
    return {
      id: value.id,
      source: value.source,
      loginUrl: value.loginUrl,
      quirks: this.decodeStringList(value.quirks),
      steps,
      template: value.template,
    }
  }

  private decodeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw new TypeError('fixture string list has an invalid shape')
    }
    const strings: string[] = []
    for (const item of value) {
      if (typeof item !== 'string') {
        throw new TypeError('fixture string list contains a non-string value')
      }
      strings.push(item)
    }
    return strings
  }

  private decodeSteps(value: unknown): SiteFixtureStep[] {
    if (!Array.isArray(value)) {
      throw new TypeError('fixture steps have an invalid shape')
    }
    const steps: SiteFixtureStep[] = []
    for (const step of value) steps.push(this.decodeStep(step))
    return steps
  }

  private decodeStep(value: unknown): SiteFixtureStep {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('fields' in value) ||
      !('submit' in value)
    ) {
      throw new TypeError('fixture step has an invalid shape')
    }
    const fields = this.decodeFields(value.fields)
    const submit = this.decodeSubmit(value.submit)
    return { fields, submit }
  }

  private decodeFields(value: unknown): SiteFixtureField[] {
    if (!Array.isArray(value)) {
      throw new TypeError('fixture fields have an invalid shape')
    }
    const fields: SiteFixtureField[] = []
    for (const field of value) fields.push(this.decodeField(field))
    return fields
  }

  private decodeField(value: unknown): SiteFixtureField {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('fixture field has an invalid shape')
    }
    const field: SiteFixtureField = {}
    if ('name' in value) field.name = this.decodeString(value.name, 'name')
    if ('type' in value) field.type = this.decodeString(value.type, 'type')
    if ('id' in value) field.id = this.decodeString(value.id, 'id')
    if ('autocomplete' in value) {
      field.autocomplete = this.decodeString(value.autocomplete, 'autocomplete')
    }
    if ('label' in value) field.label = this.decodeString(value.label, 'label')
    if ('placeholder' in value) {
      field.placeholder = this.decodeString(value.placeholder, 'placeholder')
    }
    if ('aria-label' in value) {
      field['aria-label'] = this.decodeString(value['aria-label'], 'aria-label')
    }
    if ('aria-hidden' in value) {
      field['aria-hidden'] = this.decodeString(
        value['aria-hidden'],
        'aria-hidden',
      )
    }
    if ('data-qa' in value) {
      field['data-qa'] = this.decodeString(value['data-qa'], 'data-qa')
    }
    if ('data-testid' in value) {
      field['data-testid'] = this.decodeString(
        value['data-testid'],
        'data-testid',
      )
    }
    if ('inputmode' in value) {
      if (value.inputmode !== SiteFixtureInputMode.Email) {
        throw new TypeError('fixture field inputmode has an invalid value')
      }
      field.inputmode = SiteFixtureInputMode.Email
    }
    return field
  }

  private decodeSubmit(value: unknown): SiteFixtureSubmit {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('label' in value) ||
      typeof value.label !== 'string'
    ) {
      throw new TypeError('fixture submit button has an invalid shape')
    }
    const submit: SiteFixtureSubmit = {
      type: SiteFixtureSubmitType.Submit,
      label: value.label,
    }
    if ('type' in value) {
      if (
        value.type !== SiteFixtureSubmitType.Button &&
        value.type !== SiteFixtureSubmitType.Submit
      ) {
        throw new TypeError('fixture submit button has an invalid type')
      }
      submit.type = value.type
    }
    if ('name' in value) submit.name = this.decodeString(value.name, 'name')
    if ('id' in value) submit.id = this.decodeString(value.id, 'id')
    if ('class' in value) submit.class = this.decodeString(value.class, 'class')
    if ('data-qa' in value) {
      submit['data-qa'] = this.decodeString(value['data-qa'], 'data-qa')
    }
    return submit
  }

  private decodeString(value: unknown, property: string): string {
    if (typeof value !== 'string') {
      throw new TypeError(`fixture property ${property} must be a string`)
    }
    return value
  }
}

const siteFixtureCatalogAdmission = new SiteFixtureCatalogAdmission()

const siteShells = new Map<string, SiteShellRef>()
for (const [id, value] of Object.entries(siteShellsJson)) {
  siteShells.set(id, siteFixtureCatalogAdmission.decodeSiteShellRef(value))
}

const pilotExpectations = new Map<string, SiteFixturePilotExpectation>()
for (const [id, value] of Object.entries(pilotExpectationsJson)) {
  pilotExpectations.set(
    id,
    siteFixtureCatalogAdmission.decodePilotExpectation(value),
  )
}

const templateModules = import.meta.glob('../../fixtures/templates/*.json', {
  eager: true,
  import: 'default',
})

const templatesById = new Map<string, ShellTemplate>()
for (const [pathKey, template] of Object.entries(templateModules)) {
  const fileName = pathKey.split('/').pop()
  if (!fileName) throw new Error(`shell template path is invalid: ${pathKey}`)
  const id = fileName.replace(/\.json$/u, '')
  const decodedTemplate =
    siteFixtureCatalogAdmission.decodeShellTemplateRaw(template)
  const pilotExpectation = pilotExpectations.get(id)
  if (!pilotExpectation) {
    throw new Error(`missing Pilot expectation for shell template ${id}`)
  }
  templatesById.set(id, { ...decodedTemplate, id, pilotExpectation })
}

function resolveSiteFixture(id: string): SiteFixtureLookup {
  const ref = siteShells.get(id)
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
for (const id of siteShells.keys()) {
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

export function decodeSiteFixture(value: unknown): SiteFixture {
  return siteFixtureCatalogAdmission.decodeSiteFixture(value)
}

/** Build static HTML for unit tests (first step, or final step for password shells). */
export function renderFixtureHtml(
  fixture: SiteFixture,
  options?: { stepIndex?: number; wrapAriaHidden?: boolean },
): string {
  const [stepIndex = Math.max(0, fixture.steps.length - 1)] = [
    options?.stepIndex,
  ]
  let step = fixture.steps[stepIndex]
  if (!step) [step] = fixture.steps
  if (!step) throw new Error('site fixture must contain at least one step')
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
        field.inputmode ? `inputmode="${escapeAttr(field.inputmode)}"` : '',
        field.placeholder
          ? `placeholder="${escapeAttr(field.placeholder)}"`
          : '',
        field['aria-label']
          ? `aria-label="${escapeAttr(field['aria-label'])}"`
          : '',
        field['aria-hidden']
          ? `aria-hidden="${escapeAttr(field['aria-hidden'])}"`
          : '',
        field['data-qa'] ? `data-qa="${escapeAttr(field['data-qa'])}"` : '',
        field['data-testid']
          ? `data-testid="${escapeAttr(field['data-testid'])}"`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
      const input = `<input ${attrs} />`
      return field.label
        ? `<label>${escapeHtml(field.label)}${input}</label>`
        : input
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
    step.submit.class ? `class="${escapeAttr(step.submit.class)}"` : '',
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
