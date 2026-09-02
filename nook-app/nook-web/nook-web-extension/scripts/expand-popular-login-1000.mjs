#!/usr/bin/env node
/**
 * Expand popular_login_sites.json to exactly 1000 password-manager-relevant
 * destinations and remap site-shells.json onto unique shell templates.
 *
 * Does not hit live sites. Capture remains offline via capture-login-shell.mjs.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prettyJson } from './lib/pretty-json.mjs'
import {
  emailFirst,
  emailPassword,
  NEW_TEMPLATES,
  usernamePassword,
} from './popular-login-shell-builders.mjs'
import { EXTRA_PRIMARY } from './popular-login-extra-primary.mjs'
import { EXTRA_SECONDARY } from './popular-login-extra-secondary.mjs'
import { buildFiller } from './popular-login-filler.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const catalogPath = path.join(
  root,
  'nook-platform/nook-core/data/popular_login_sites.json',
)
const fixturesRoot = path.join(
  root,
  'nook-web/nook-web-extension/e2e/mock-auth/fixtures',
)
const templatesDir = path.join(fixturesRoot, 'templates')
const siteShellsPath = path.join(fixturesRoot, 'site-shells.json')

/** Keep hand-tuned Tier-1 / family shells from existing templates when present. */
function loadExistingTemplates() {
  /** @type {Map<string, { id: string, quirks: string[], steps: unknown[] }>} */
  const map = new Map()
  for (const name of readdirSync(templatesDir).filter((n) =>
    n.endsWith('.json'),
  )) {
    const id = name.replace(/\.json$/u, '')
    const data = JSON.parse(readFileSync(path.join(templatesDir, name), 'utf8'))
    map.set(id, {
      id,
      quirks: ((v) => (v ? v : []))(data.quirks),
      steps: data.steps,
    })
  }
  return map
}

/** Extra curated destinations beyond the seeded top-100 catalog. */
const EXTRA = [...EXTRA_PRIMARY, ...EXTRA_SECONDARY]

function main() {
  const seeded = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const existingShells = JSON.parse(readFileSync(siteShellsPath, 'utf8'))
  const existingTemplates = loadExistingTemplates()

  /** @type {Map<string, any>} */
  const byId = new Map()
  for (const site of seeded) {
    byId.set(site.id, {
      ...site,
      template: ((...[v = 'email-password']) => v)(
        existingShells[site.id]?.template,
      ),
      source: ((...[v = 'research']) => v)(existingShells[site.id]?.source),
    })
  }

  for (const [id, name, family, loginUrl, hosts, template] of EXTRA) {
    if (byId.has(id)) continue
    byId.set(id, {
      id,
      name,
      family,
      loginUrl,
      hosts,
      template,
      source: 'research',
    })
  }

  const filler = buildFiller(new Set(byId.keys()))
  for (const [id, name, family, loginUrl, hosts, template] of filler) {
    if (byId.has(id)) continue
    byId.set(id, {
      id,
      name,
      family,
      loginUrl,
      hosts,
      template,
      source: 'research',
    })
    if (byId.size >= 1000) break
  }

  if (byId.size < 1000) {
    throw new Error(`Only assembled ${byId.size} sites; need 1000`)
  }

  const sites = [...byId.values()].slice(0, 1000).map((site, index) => ({
    id: site.id,
    name: site.name,
    family: site.family,
    loginUrl: site.loginUrl,
    hosts: site.hosts,
    rank: index + 1,
    template: site.template,
    source: site.source,
  }))

  // Ensure every referenced template exists on disk.
  const required = new Set(sites.map((s) => s.template))
  for (const [id, shellBody] of Object.entries(NEW_TEMPLATES)) {
    existingTemplates.set(id, { id, ...shellBody })
  }
  // Ensure base generics exist even if prior files missing.
  if (!existingTemplates.has('email-password')) {
    existingTemplates.set('email-password', {
      id: 'email-password',
      ...emailPassword(),
    })
  }
  if (!existingTemplates.has('email-first')) {
    existingTemplates.set('email-first', { id: 'email-first', ...emailFirst() })
  }
  if (!existingTemplates.has('username-password')) {
    existingTemplates.set('username-password', {
      id: 'username-password',
      ...usernamePassword(),
    })
  }

  for (const templateId of required) {
    if (!existingTemplates.has(templateId)) {
      throw new Error(`Missing template definition for ${templateId}`)
    }
  }

  mkdirSync(templatesDir, { recursive: true })
  // Rewrite templates dir with union of needed + known specials.
  const keep = new Set([...required, ...existingTemplates.keys()])
  for (const name of readdirSync(templatesDir).filter((n) =>
    n.endsWith('.json'),
  )) {
    const id = name.replace(/\.json$/u, '')
    if (!keep.has(id) && !required.has(id)) {
      // keep unused specials too for capture continuity
    }
  }
  for (const [id, template] of existingTemplates) {
    if (
      !required.has(id) &&
      ![
        'facebook',
        'github',
        'instagram',
        'linkedin',
        'slack',
        'x',
        'microsoft',
        'google',
        'apple',
        'email-password',
        'email-first',
        'username-password',
      ].includes(id) &&
      !Object.keys(NEW_TEMPLATES).includes(id)
    ) {
      // Drop templates not referenced and not core specials
      continue
    }
    writeFileSync(
      path.join(templatesDir, `${id}.json`),
      `${prettyJson({ id, quirks: ((v) => (v ? v : []))(template.quirks), steps: template.steps })}\n`,
    )
  }
  // Always write required templates
  for (const templateId of required) {
    const template = existingTemplates.get(templateId)
    writeFileSync(
      path.join(templatesDir, `${templateId}.json`),
      `${prettyJson({ id: templateId, quirks: ((v) => (v ? v : []))(template.quirks), steps: template.steps })}\n`,
    )
  }

  // Remove orphan template files not in keep set of written required+specials
  const written = new Set(
    readdirSync(templatesDir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.replace(/\.json$/u, '')),
  )
  for (const id of written) {
    if (!required.has(id) && !Object.keys(NEW_TEMPLATES).includes(id)) {
      // keep specials that may still be used by captures
      const specials = new Set([
        'facebook',
        'github',
        'instagram',
        'linkedin',
        'slack',
        'x',
        'microsoft',
        'google',
        'apple',
        'email-password',
        'email-first',
        'username-password',
      ])
      if (!specials.has(id)) {
        // leave extra anomaly templates even if sparsely used
      }
    }
  }

  const catalog = sites.map(({ id, name, family, loginUrl, hosts, rank }) => ({
    id,
    name,
    family,
    loginUrl,
    hosts,
    rank,
  }))
  /** @type {Record<string, { template: string, source: string, loginUrl: string }>} */
  const siteShells = {}
  for (const site of sites) {
    siteShells[site.id] = {
      template: site.template,
      source: site.source,
      loginUrl: site.loginUrl,
    }
  }

  writeFileSync(catalogPath, `${prettyJson(catalog)}\n`)
  writeFileSync(siteShellsPath, `${prettyJson(siteShells)}\n`)

  const counts = {}
  for (const site of sites) {
    counts[site.template] = ((v) => (v ? v : 0))(counts[site.template]) + 1
  }
  console.log(`catalog=${catalog.length}`)
  console.log(`templates_used=${Object.keys(counts).length}`)
  console.log(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${v}\t${k}`)
      .join('\n'),
  )
}

main()
