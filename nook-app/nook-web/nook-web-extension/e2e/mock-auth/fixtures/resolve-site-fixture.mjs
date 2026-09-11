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

/** @typedef {{ id: string, quirks: string[], steps: Array<{ fields: Array<{ type?: string }>, submit: { label: string } }>, pilotExpectation: string }} ShellTemplate */
/** @typedef {{ template: string, source: string, loginUrl: string, quirks?: string[], steps?: unknown[] }} SiteShellRef */

const siteShells = /** @type {Record<string, SiteShellRef>} */ (
  JSON.parse(readFileSync(siteShellsPath, 'utf8'))
)
const pilotExpectations = /** @type {Record<string, string>} */ (
  JSON.parse(readFileSync(pilotExpectationsPath, 'utf8'))
)

/** @type {Map<string, ShellTemplate>} */
const templatesById = new Map()
for (const name of readdirSync(templatesDir).filter((n) =>
  n.endsWith('.json'),
)) {
  const id = name.replace(/\.json$/u, '')
  const template = JSON.parse(
    readFileSync(path.join(templatesDir, name), 'utf8'),
  )
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
