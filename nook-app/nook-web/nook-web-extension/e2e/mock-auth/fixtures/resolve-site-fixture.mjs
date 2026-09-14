/**
 * Node-side resolver for popular-login fixtures (unit + Playwright).
 * Vite mock-auth uses the TypeScript twin in src/lib/site-fixtures.ts.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const templatesDir = path.join(here, 'templates')
const siteShellsPath = path.join(here, 'site-shells.json')
const pilotExpectationsPath = path.join(here, 'pilot-expectations.json')

export const ShellTemplatePilotExpectation = Object.freeze({
  ContinueWithNook: 'continue-with-nook',
  FailClosedAlternateAuthentication: 'fail-closed-alternate-authentication',
})

/** @typedef {{ id: string, quirks: string[], steps: Array<{ fields: Array<{ type?: string, inputmode?: string, autocomplete?: string, label?: string }>, submit: { type?: string, label: string } }>, pilotExpectation: string }} ShellTemplate */
/** @typedef {{ template: string, source: string, loginUrl: string, quirks?: string[], steps?: ShellTemplate['steps'] }} SiteShellRef */

/** @type {{ parse: (value: string) => unknown }} */
const safeJson = JSON

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value @returns {value is SiteShellRef} */
function isSiteShellRef(value) {
  return (
    isObjectRecord(value) &&
    typeof value.template === 'string' &&
    typeof value.source === 'string' &&
    typeof value.loginUrl === 'string'
  )
}

/** @param {unknown} value @returns {value is ShellTemplate} */
function isShellTemplate(value) {
  return (
    isObjectRecord(value) &&
    typeof value.id === 'string' &&
    Array.isArray(value.quirks) &&
    value.quirks.every((quirk) => typeof quirk === 'string') &&
    Array.isArray(value.steps)
  )
}

const siteShellsValue = safeJson.parse(readFileSync(siteShellsPath, 'utf8'))
if (!isObjectRecord(siteShellsValue)) {
  throw new Error('Invalid site shell catalog')
}
/** @type {Record<string, SiteShellRef>} */
const siteShells = {}
for (const [id, value] of Object.entries(siteShellsValue)) {
  if (isSiteShellRef(value)) siteShells[id] = value
}
const pilotExpectationsValue = safeJson.parse(
  readFileSync(pilotExpectationsPath, 'utf8'),
)
if (!isObjectRecord(pilotExpectationsValue)) {
  throw new Error('Invalid Pilot expectation catalog')
}
/** @type {Record<string, string>} */
const pilotExpectations = {}
for (const [id, value] of Object.entries(pilotExpectationsValue)) {
  if (typeof value === 'string') pilotExpectations[id] = value
}

/** @type {Map<string, ShellTemplate>} */
const templatesById = new Map()
for (const name of readdirSync(templatesDir).filter((n) =>
  n.endsWith('.json'),
)) {
  const id = name.replace(/\.json$/u, '')
  const template = safeJson.parse(
    readFileSync(path.join(templatesDir, name), 'utf8'),
  )
  if (!isShellTemplate(template)) {
    throw new Error(`invalid shell template ${id}`)
  }
  const pilotExpectation = pilotExpectations[id]
  if (!pilotExpectation) {
    throw new Error(`missing Pilot expectation for shell template ${id}`)
  }
  templatesById.set(id, { ...template, id, pilotExpectation })
}

/**
 * @param {string} id
 * @returns {{
 *   id: string,
 *   source: string,
 *   loginUrl: string,
 *   quirks: string[],
 *   steps: Array<{ fields: Array<{ type?: string }>, submit: { label: string } }>,
 *   template: string,
 * } | void}
 */
export function resolveSiteFixture(id) {
  const ref = siteShells[id]
  if (!ref) return
  const template = templatesById.get(ref.template)
  const [steps = template?.steps] = [ref.steps]
  if (!steps || steps.length === 0) return
  return {
    id,
    source: ref.source,
    loginUrl: ref.loginUrl,
    quirks: ((v) => (v ? v : []))(
      ((...[v = template?.quirks]) => v)(ref.quirks),
    ),
    steps,
    template: ref.template,
  }
}

export function listSiteShellIds() {
  return Object.keys(siteShells).sort()
}

export function listShellTemplateIds() {
  return [...templatesById.keys()].sort()
}

/** @param {string} id */
export function getShellTemplate(id) {
  return templatesById.get(id)
}

export function siteShellCount() {
  return Object.keys(siteShells).length
}

export function shellTemplateCount() {
  return templatesById.size
}
