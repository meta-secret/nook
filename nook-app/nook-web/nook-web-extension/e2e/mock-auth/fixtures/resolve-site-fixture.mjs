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

/** @typedef {{ id: string, quirks: string[], steps: unknown[] }} ShellTemplate */
/** @typedef {{ template: string, source: string, loginUrl: string, quirks?: string[], steps?: unknown[] }} SiteShellRef */

const siteShells = /** @type {Record<string, SiteShellRef>} */ (
  JSON.parse(readFileSync(siteShellsPath, 'utf8'))
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
  templatesById.set(id, { ...template, id })
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
 * } | undefined}
 */
export function resolveSiteFixture(id) {
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
