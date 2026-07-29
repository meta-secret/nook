#!/usr/bin/env node
/**
 * Generates popular_login_sites.json (100 entries) and mock-auth fixtures.
 * Research-based structural shells; capture-login-shell.mjs can overwrite with live drafts.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prettyJson } from './lib/pretty-json.mjs'
import { createHash } from 'node:crypto'
import { buildPopularLoginFixtureData } from './popular-login-fixture-data.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const catalogPath = path.join(root, 'nook-core/data/popular_login_sites.json')
const fixturesRoot = path.join(
  root,
  'nook-web/nook-web-extension/e2e/mock-auth/fixtures',
)
const templatesDir = path.join(fixturesRoot, 'templates')
const siteShellsPath = path.join(fixturesRoot, 'site-shells.json')
const legacySitesDir = path.join(fixturesRoot, 'sites')

/** @typedef {{ name: string, type?: string, id?: string, autocomplete?: string, placeholder?: string, 'aria-label'?: string, 'data-qa'?: string, 'data-testid'?: string }} Field */
/** @typedef {{ fields: Field[], submit: { type?: string, name?: string, id?: string, label: string } }} Step */

function field(partial) {
  return {
    type: 'text',
    ...partial,
  }
}

function emailPassword({
  emailName = 'email',
  emailType = 'email',
  passName = 'password',
  emailAutocomplete = 'username',
  quirks = [],
  submitLabel = 'Sign in',
} = {}) {
  return {
    quirks,
    steps: [
      {
        fields: [
          field({
            name: emailName,
            type: emailType,
            autocomplete: emailAutocomplete,
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
          field({
            name: passName,
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: submitLabel },
      },
    ],
  }
}

function usernamePassword({
  userName = 'username',
  passName = 'password',
  submitLabel = 'Sign in',
  quirks = [],
} = {}) {
  return {
    quirks,
    steps: [
      {
        fields: [
          field({
            name: userName,
            type: 'text',
            autocomplete: 'username',
            placeholder: 'Username',
            'aria-label': 'Username',
          }),
          field({
            name: passName,
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: submitLabel },
      },
    ],
  }
}

function emailFirst({
  emailName = 'email',
  emailType = 'email',
  passName = 'password',
  continueLabel = 'Continue',
  signInLabel = 'Sign in',
  quirks = [],
} = {}) {
  return {
    quirks,
    steps: [
      {
        fields: [
          field({
            name: emailName,
            type: emailType,
            autocomplete: 'username',
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
        ],
        submit: { type: 'submit', label: continueLabel },
      },
      {
        fields: [
          field({
            name: emailName,
            type: emailType,
            autocomplete: 'username',
            placeholder: 'Email',
            'aria-label': 'Email',
          }),
          field({
            name: passName,
            type: 'password',
            autocomplete: 'current-password',
            placeholder: 'Password',
            'aria-label': 'Password',
          }),
        ],
        submit: { type: 'submit', label: signInLabel },
      },
    ],
  }
}

const { SPECIAL, SITES } = buildPopularLoginFixtureData({
  field,
  emailPassword,
  usernamePassword,
  emailFirst,
})

if (SITES.length !== 100) {
  console.error(`Expected 100 sites, got ${SITES.length}`)
  process.exit(1)
}

function shellFor(id, family) {
  if (SPECIAL[id]) return SPECIAL[id]
  if (SPECIAL[family]) return SPECIAL[family]
  // Banks / financial often username+password
  if (
    [
      'chase',
      'bankofamerica',
      'wellsfargo',
      'citi',
      'capitalone',
      'usbank',
      'americanexpress',
      'discover',
      'schwab',
      'fidelity',
      'vanguard',
      'robinhood',
    ].includes(id)
  ) {
    return usernamePassword({ userName: 'username', passName: 'password' })
  }
  // SSO-style email-first for many SaaS
  if (
    [
      'okta',
      'auth0',
      'salesforce',
      'hubspot',
      'zendesk',
      'asana',
      'notion',
      'figma',
      'canva',
      'shopify',
      'stripe',
      'cloudflare',
      'vercel',
      'netlify',
      'heroku',
      'digitalocean',
      'monday',
      'atlassian',
      'trello',
      'zoom',
      'dropbox',
      'adobe',
      'squarespace',
      'wordpress',
      'bitbucket',
      'gitlab',
      'onepassword',
      'lastpass',
      'bitwarden',
      'proton',
      'coinbase',
      'binance',
      'venmo',
      'cashapp',
    ].includes(id)
  ) {
    return emailFirst()
  }
  // Streaming / shopping / social default: email+password
  return emailPassword()
}

const CAPTURE_IDS = new Set([
  'facebook',
  'google',
  'microsoft',
  'apple',
  'amazon',
  'github',
  'linkedin',
  'x',
  'slack',
  'instagram',
])

const SPECIAL_TEMPLATE_IDS = {
  facebook: 'facebook',
  github: 'github',
  instagram: 'instagram',
  linkedin: 'linkedin',
  slack: 'slack',
  x: 'x',
  microsoft: 'microsoft',
  azure: 'microsoft',
  office: 'microsoft',
  outlook: 'microsoft',
  google: 'google',
  gmail: 'google',
  youtube: 'google',
  apple: 'apple',
  icloud: 'apple',
}

function shapeKey(shell) {
  return JSON.stringify({
    quirks: shell.quirks ?? [],
    steps: shell.steps,
  })
}

function genericTemplateName(shell) {
  const steps = shell.steps ?? []
  const names = (steps[0]?.fields ?? []).map((field) => field.name)
  if (steps.length === 1 && names[0] === 'email' && names[1] === 'password') {
    return { matched: true, templateName: 'email-password' }
  }
  if (
    steps.length === 1 &&
    names[0] === 'username' &&
    names[1] === 'password'
  ) {
    return { matched: true, templateName: 'username-password' }
  }
  if (steps.length >= 2 && names[0] === 'email')
    return { matched: true, templateName: 'email-first' }
  if (steps.length >= 2 && names[0] === 'loginfmt')
    return { matched: true, templateName: 'microsoft' }
  if (steps.length >= 2 && names[0] === 'identifier')
    return { matched: true, templateName: 'google' }
  if (steps.length === 1 && names[0] === 'accountName')
    return { matched: true, templateName: 'apple' }
  return { matched: false }
}

const catalog = SITES.map(([id, name, family, loginUrl, hosts], index) => ({
  id,
  name,
  family,
  loginUrl,
  hosts,
  rank: index + 1,
}))

writeFileSync(catalogPath, `${prettyJson(catalog)}\n`)

/** @type {Map<string, { quirks: string[], steps: unknown[] }>} */
const shellsById = new Map()
for (const site of catalog) {
  const shell = shellFor(site.id, site.family)
  shellsById.set(site.id, {
    quirks: shell.quirks ?? [],
    steps: shell.steps,
  })
}

/** @type {Map<string, string>} */
const templateIdByShape = new Map()
/** @type {Map<string, { id: string, quirks: string[], steps: unknown[] }>} */
const templates = new Map()

for (const site of catalog) {
  const shell = shellsById.get(site.id)
  const key = shapeKey(shell)
  if (templateIdByShape.has(key)) continue
  const genericTemplate = genericTemplateName(shell)
  let templateId =
    SPECIAL_TEMPLATE_IDS[site.id] ??
    (genericTemplate.matched ? genericTemplate.templateName : site.id)
  const existing = templates.get(templateId)
  if (existing && shapeKey(existing) !== key) {
    templateId = `${templateId}-${createHash('sha1').update(key).digest('hex').slice(0, 6)}`
  }
  templateIdByShape.set(key, templateId)
  if (!templates.has(templateId)) {
    templates.set(templateId, {
      id: templateId,
      quirks: shell.quirks,
      steps: shell.steps,
    })
  }
}

rmSync(legacySitesDir, { recursive: true, force: true })
rmSync(templatesDir, { recursive: true, force: true })
mkdirSync(templatesDir, { recursive: true })

for (const [templateId, template] of [...templates.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  writeFileSync(
    path.join(templatesDir, `${templateId}.json`),
    `${prettyJson(template)}\n`,
  )
}

/** @type {Record<string, { template: string, source: string, loginUrl: string }>} */
const siteShells = {}
for (const site of catalog) {
  const shell = shellsById.get(site.id)
  const template = templateIdByShape.get(shapeKey(shell))
  siteShells[site.id] = {
    template,
    source: CAPTURE_IDS.has(site.id) ? 'capture' : 'research',
    loginUrl: site.loginUrl,
  }
}

writeFileSync(siteShellsPath, `${prettyJson(siteShells)}\n`)

console.log(`Wrote ${catalog.length} catalog entries → ${catalogPath}`)
console.log(`Wrote ${templates.size} shell templates → ${templatesDir}`)
console.log(`Wrote ${catalog.length} site→template map → ${siteShellsPath}`)
