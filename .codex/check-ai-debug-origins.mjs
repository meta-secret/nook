#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const expected = JSON.parse(
  readFileSync(join(root, '.codex/ai-debug-allowed-origins.json'), 'utf8'),
)

function fail(message) {
  console.error(message)
  process.exit(1)
}

function extractAllowedOriginsArg(text, label) {
  const match = text.match(/--allowed-origins=([^\s"]+)/)
  if (!match) {
    fail(`${label} is missing --allowed-origins.`)
  }
  return match[1].split(';').filter(Boolean)
}

function assertSameOrigins(actual, label) {
  const missing = expected.filter((origin) => !actual.includes(origin))
  const extra = actual.filter((origin) => !expected.includes(origin))
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `${label} origins drift from .codex/ai-debug-allowed-origins.json.\n` +
        `missing: ${missing.join(', ') || '(none)'}\n` +
        `extra: ${extra.join(', ') || '(none)'}`,
    )
  }
}

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
    fail(`.codex/ai-debug-allowed-origins.json must include ${required} origins.`)
  }
}

const localOnly = readFileSync(join(root, '.codex/playwright-local-only.ts'), 'utf8')
for (const origin of expected) {
  if (!localOnly.includes(`'${origin}'`)) {
    fail(`.codex/playwright-local-only.ts is missing origin ${origin}.`)
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
  const cursorMcp = JSON.parse(readFileSync(cursorMcpPath, 'utf8'))
  const playwright = cursorMcp?.mcpServers?.playwright
  if (!playwright) {
    fail('.cursor/mcp.json must define mcpServers.playwright.')
  }
  if (playwright.command !== 'bash') {
    fail('.cursor/mcp.json playwright.command must be bash.')
  }
  const args = playwright.args ?? []
  if (args[0] !== '.codex/run-playwright-mcp.sh') {
    fail('.cursor/mcp.json must launch .codex/run-playwright-mcp.sh.')
  }
  if (!args.includes('--caps=devtools')) {
    fail('.cursor/mcp.json must enable --caps=devtools.')
  }
  if (!args.includes('--ignore-https-errors')) {
    fail('.cursor/mcp.json must pass --ignore-https-errors.')
  }
  const originsArg = args.find((arg) => arg.startsWith('--allowed-origins='))
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
  const servers = JSON.parse(raw)
  const server = servers.find(({ name }) => name === 'playwright')
  if (!server?.enabled) {
    throw new Error(
      'Playwright MCP is not enabled or visible to Codex. Trust this repository, then restart Codex so .codex/config.toml is loaded.',
    )
  }
  if (
    server.transport?.type !== 'stdio' ||
    server.transport.command !== 'bash' ||
    server.transport.args?.[0] !== '.codex/run-playwright-mcp.sh' ||
    !server.transport.args?.includes('--caps=devtools') ||
    !server.transport.args?.includes('--ignore-https-errors')
  ) {
    throw new Error(
      'The Codex Playwright MCP server is missing its session launcher, --caps=devtools, or --ignore-https-errors.',
    )
  }
  const originsArg = server.transport.args.find((arg) =>
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
      ? String(error.stderr || error.message || error)
      : String(error?.message || error)
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
