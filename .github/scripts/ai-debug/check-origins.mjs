#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @typedef {{ command: string, args?: string[] }} CursorPlaywrightConfig */
/** @typedef {{ mcpServers?: { playwright?: CursorPlaywrightConfig } }} CursorMcpConfig */
/** @typedef {{ name: string, enabled: boolean, transport: { type: string, command: string, args: string[] } }} CodexMcpServer */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param {string} text @returns {unknown} */
function parseJson(text) {
  const parse = /** @type {(source: string) => unknown} */ (JSON.parse.bind(JSON))
  return parse(text)
}

/** @param {unknown} value @returns {string[]} */
function parseStringArray(value) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error('expected a JSON array of strings')
  }
  return value
}

/** @param {unknown} value @returns {CursorMcpConfig} */
function parseCursorMcpConfig(value) {
  if (!isRecord(value)) throw new Error('expected a Cursor MCP object')
  const servers = value.mcpServers
  if (servers === undefined) return {}
  if (!isRecord(servers)) throw new Error('mcpServers must be an object')
  const playwright = servers.playwright
  if (playwright === undefined) return { mcpServers: {} }
  if (!isRecord(playwright) || typeof playwright.command !== 'string') {
    throw new Error('playwright MCP configuration is invalid')
  }
  const args = playwright.args
  const parsedArgs = args === undefined ? undefined : parseStringArray(args)
  return {
    mcpServers: {
      playwright: {
        command: playwright.command,
        ...(parsedArgs === undefined ? {} : { args: parsedArgs }),
      },
    },
  }
}

/** @param {unknown} value @returns {CodexMcpServer[]} */
function parseCodexMcpServers(value) {
  if (!Array.isArray(value)) throw new Error('Codex MCP list must be an array')
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.enabled !== 'boolean' || !isRecord(entry.transport)) {
      throw new Error('Codex MCP server entry is invalid')
    }
    const { transport } = entry
    if (typeof transport.type !== 'string' || typeof transport.command !== 'string') {
      throw new Error('Codex MCP transport is invalid')
    }
    const args = parseStringArray(transport.args)
    return { name: entry.name, enabled: entry.enabled, transport: { type: transport.type, command: transport.command, args } }
  })
}

/** @param {unknown} value @returns {string} */
function errorText(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    const serialized = JSON.stringify(value)
    return serialized ?? 'unknown error'
  } catch {
    return 'unknown error'
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
/** @type {string[]} */
const expected = parseStringArray(parseJson(
  readFileSync(join(root, '.github/scripts/ai-debug/allowed-origins.json'), 'utf8'),
))

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(message)
  process.exit(1)
}

/** @param {string} text @param {string} label @returns {string[]} */
function extractAllowedOriginsArg(text, label) {
  const match = text.match(/--allowed-origins=([^\s"]+)/)
  const originText = match?.[1]
  if (!originText) {
    fail(`${label} is missing --allowed-origins.`)
  }
  return originText.split(';').filter(Boolean)
}

/** @param {readonly string[]} actual @param {string} label */
function assertSameOrigins(actual, label) {
  const missing = expected.filter((origin) => !actual.includes(origin))
  const extra = actual.filter((origin) => !expected.includes(origin))
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `${label} origins drift from .github/scripts/ai-debug/allowed-origins.json.\n` +
        `missing: ${missing.join(', ') || '(none)'}\n` +
        `extra: ${extra.join(', ') || '(none)'}`,
    )
  }
}

/** @param {string} path */
function fileExists(path) {
  try {
    readFileSync(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

const schemes = new Set(expected.map((origin) => new URL(origin).protocol))
for (const required of ['http:', 'https:', 'ws:', 'wss:']) {
  if (!schemes.has(required)) {
    fail(`.github/scripts/ai-debug/allowed-origins.json must include ${required} origins.`)
  }
}

const localOnly = readFileSync(join(root, '.github/scripts/ai-debug/local-only.ts'), 'utf8')
for (const origin of expected) {
  if (!localOnly.includes(`'${origin}'`)) {
    fail(`.github/scripts/ai-debug/local-only.ts is missing origin ${origin}.`)
  }
}

const configToml = readFileSync(join(root, '.codex/config.toml'), 'utf8')
if (!configToml.includes('--ignore-https-errors')) {
  fail('.codex/config.toml must pass --ignore-https-errors for local HTTPS certs.')
}
assertSameOrigins(
  extractAllowedOriginsArg(configToml, '.codex/config.toml'),
  '.codex/config.toml',
)

const cursorMcpPath = join(root, '.cursor/mcp.json')
let cursorConfigured = false
if (fileExists(cursorMcpPath)) {
  const cursorMcp = parseCursorMcpConfig(parseJson(readFileSync(cursorMcpPath, 'utf8')))
  const playwright = cursorMcp?.mcpServers?.playwright
  if (!playwright) {
    fail('.cursor/mcp.json must define mcpServers.playwright.')
  }
  if (playwright.command !== 'bash') {
    fail('.cursor/mcp.json playwright.command must be bash.')
  }
  const { args = [] } = playwright
  if (args[0] !== '.github/scripts/ai-debug/run-playwright-mcp.sh') {
    fail('.cursor/mcp.json must launch .github/scripts/ai-debug/run-playwright-mcp.sh.')
  }
  if (!args.includes('--caps=devtools')) {
    fail('.cursor/mcp.json must enable --caps=devtools.')
  }
  if (!args.includes('--ignore-https-errors')) {
    fail('.cursor/mcp.json must pass --ignore-https-errors.')
  }
  const originsArg = args.find(
    /** @type {(arg: string) => boolean} */ (arg) =>
      arg.startsWith('--allowed-origins='),
  )
  if (!originsArg) {
    fail('.cursor/mcp.json is missing --allowed-origins.')
  }
  assertSameOrigins(
    originsArg.slice('--allowed-origins='.length).split(';').filter(Boolean),
    '.cursor/mcp.json',
  )
  cursorConfigured = true
}

let codexConfigured = false
let codexError = ''
try {
  const raw = execFileSync('codex', ['mcp', 'list', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const servers = parseCodexMcpServers(parseJson(raw))
  const server = servers.find(({ name }) => name === 'playwright')
  if (!server?.enabled) {
    throw new Error(
      'Playwright MCP is not enabled or visible to Codex. Trust this repository, then restart Codex so .codex/config.toml is loaded.',
    )
  }
  if (
    server.transport?.type !== 'stdio' ||
    server.transport.command !== 'bash' ||
    server.transport.args?.[0] !== '.github/scripts/ai-debug/run-playwright-mcp.sh' ||
    !server.transport.args?.includes('--caps=devtools') ||
    !server.transport.args?.includes('--ignore-https-errors')
  ) {
    throw new Error(
      'The Codex Playwright MCP server is missing its session launcher, --caps=devtools, or --ignore-https-errors.',
    )
  }
  const originsArg = server.transport.args.find((arg /** @type {string} */) =>
    arg.startsWith('--allowed-origins='),
  )
  if (!originsArg) {
    throw new Error('Codex Playwright MCP server is missing --allowed-origins.')
  }
  assertSameOrigins(
    originsArg.slice('--allowed-origins='.length).split(';').filter(Boolean),
    'codex mcp list',
  )
  codexConfigured = true
} catch (error) {
  codexError =
    error && typeof error === 'object' && 'stderr' in error
      ? errorText(error.stderr)
      : errorText(error)
}

if (!codexConfigured && !cursorConfigured) {
  fail(
    'Neither Codex nor Cursor Playwright MCP configuration is available.\n' +
      'Install/trust Codex for .codex/config.toml, or enable .cursor/mcp.json in Cursor.\n' +
      codexError,
  )
}

console.log(
  `AI-debug origins OK (${expected.length} entries; Codex=${codexConfigured}; Cursor=${cursorConfigured}).`,
)
