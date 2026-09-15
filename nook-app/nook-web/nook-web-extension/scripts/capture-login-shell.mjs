#!/usr/bin/env node
/**
 * One-time local capture of a live login page into a structural shell template.
 * Never run in CI. Usage:
 *   node scripts/capture-login-shell.mjs <site-id>
 *   node scripts/capture-login-shell.mjs --all
 *
 * Writes/updates fixtures/templates/<site-id>.json and points site-shells.json
 * at that template. Does not store cookies, passwords, or PII.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prettyJson } from './lib/pretty-json.mjs'

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

/** @typedef {{ id: string, loginUrl: string }} LoginSite */
/** @typedef {{ template: string, source: string, loginUrl: string }} SiteShell */

/** @type {{ parse: (value: string) => unknown }} */
const safeJson = JSON

/** @param {unknown} value @returns {value is Record<string, unknown>} */
class LoginShellCapture {
  /** @param {LoginSite[]} catalog @param {Record<string, SiteShell>} siteShells */
  constructor(catalog, siteShells) {
    this.catalog = catalog
    this.siteShells = siteShells
  }

  /** @param {unknown} value @returns {value is Record<string, unknown>} */
  static isObjectRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  /** @param {unknown} value @returns {value is LoginSite} */
  static isLoginSite(value) {
    return (
      this.isObjectRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.loginUrl === 'string'
    )
  }

  /** @param {unknown} value @returns {value is SiteShell} */
  static isSiteShell(value) {
    return (
      this.isObjectRecord(value) &&
      typeof value.template === 'string' &&
      typeof value.source === 'string' &&
      typeof value.loginUrl === 'string'
    )
  }

  /** @param {string} id @returns {LoginSite | false} */
  siteById(id) {
    for (const site of this.catalog) {
      if (site.id === id) return site
    }
    return false
  }

  /** @param {LoginSite} site */
  async captureSite(site) {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const templateId = site.id
    const templatePath = path.join(templatesDir, `${templateId}.json`)
    try {
      await page.goto(site.loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      await page.waitForTimeout(2_000)
      const fields = await page.evaluate(() => {
        const inputs = [
          ...document.querySelectorAll(
            'input:not([type="hidden"]):not([disabled])',
          ),
        ]
        return inputs
          .filter((input) => {
            const type = (input.getAttribute('type') || 'text').toLowerCase()
            return ['text', 'email', 'tel', 'password', 'search'].includes(type)
          })
          .slice(0, 8)
          .map((input) => {
            /** @type {Record<string, string>} */
            const field = {
              type: (input.getAttribute('type') || 'text').toLowerCase(),
            }
            for (const key of [
              'name',
              'id',
              'autocomplete',
              'placeholder',
              'aria-label',
            ]) {
              const value = input.getAttribute(key)
              if (value) field[key] = value
            }
            const dataQa = input.getAttribute('data-qa')
            if (dataQa) field['data-qa'] = dataQa
            const dataTestId = input.getAttribute('data-testid')
            if (dataTestId) field['data-testid'] = dataTestId
            return field
          })
      })
      const identity = fields.filter((field) => field.type !== 'password')
      const passwords = fields.filter((field) => field.type === 'password')
      if (identity.length === 0 && passwords.length === 0) {
        throw new Error('no identity/password fields found')
      }
      const [password] = passwords
      const stepFields = password
        ? [...identity.slice(0, 1), password]
        : identity.slice(0, 1)
      const template = {
        id: templateId,
        quirks: [],
        steps: [
          {
            fields: stepFields,
            submit: { type: 'submit', label: 'Sign in' },
          },
        ],
      }
      mkdirSync(templatesDir, { recursive: true })
      writeFileSync(templatePath, `${prettyJson(template)}\n`)
      this.siteShells[site.id] = {
        template: templateId,
        source: 'capture',
        loginUrl: site.loginUrl,
      }
      writeFileSync(siteShellsPath, `${prettyJson(this.siteShells)}\n`)
      console.log(`captured ${site.id} → template ${templateId}`)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`capture failed for ${site.id}: ${message}`)
      if (existsSync(templatePath) || this.siteShells[site.id]) {
        console.warn(`keeping existing shell mapping for ${site.id}`)
      }
      return false
    } finally {
      await browser.close()
    }
  }
}

const catalogValue = safeJson.parse(readFileSync(catalogPath, 'utf8'))
if (
  !Array.isArray(catalogValue) ||
  !catalogValue.every(LoginShellCapture.isLoginSite)
) {
  throw new Error('Invalid popular login catalog')
}
const catalog = catalogValue
const siteShellsValue = safeJson.parse(readFileSync(siteShellsPath, 'utf8'))
if (!LoginShellCapture.isObjectRecord(siteShellsValue)) {
  throw new Error('Invalid site shell catalog')
}
/** @type {Record<string, SiteShell>} */
const siteShells = {}
for (const [id, value] of Object.entries(siteShellsValue)) {
  if (LoginShellCapture.isSiteShell(value)) siteShells[id] = value
}
const loginShellCapture = new LoginShellCapture(catalog, siteShells)

const args = process.argv.slice(2)
if (args[0] === '--all') {
  let ok = 0
  for (const site of catalog) {
    if (await loginShellCapture.captureSite(site)) ok += 1
  }
  console.log(`captured ${ok}/${catalog.length}`)
  process.exit(0)
}

const id = args[0]
if (!id) {
  console.error('Usage: capture-login-shell.mjs <site-id> | --all')
  process.exit(2)
}
const site = loginShellCapture.siteById(id)
if (!site) {
  console.error(`Unknown site id: ${id}`)
  process.exit(2)
}
const success = await loginShellCapture.captureSite(site)
process.exit(success ? 0 : 1)
