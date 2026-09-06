import path from 'node:path'
import { fileURLToPath } from 'node:url'
import gates from '../playwright.gates.json' with { type: 'json' }

enum E2eProject {
  Stable = 'stable',
  Unstable = 'unstable',
  SyncLive = 'sync-live',
}

const projects: readonly E2eProject[] = [
  E2eProject.Stable,
  E2eProject.Unstable,
  E2eProject.SyncLive,
]
const maxSpecs = 16
const maxSpecLength = 240
const maxGrepLength = 500
const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function fail(message: string): never {
  console.error(`E2E debug selection rejected: ${message}`)
  process.exit(2)
}

function environmentValue(name: string): string {
  const value = process.env[name]
  return value ? value.trim() : ''
}

function readProject(): E2eProject {
  const project = environmentValue('E2E_PROJECT')
  if (!projects.includes(project as E2eProject)) {
    fail(`E2E_PROJECT must be one of: ${projects.join(', ')}`)
  }
  return project as E2eProject
}

function normalizeSpec(rawSpec: string): string {
  const spec = rawSpec.trim()
  if (!spec) {
    fail('E2E_SPECS must not contain empty entries')
  }
  if (spec.length > maxSpecLength) {
    fail(`spec paths must be at most ${maxSpecLength} characters`)
  }
  if (path.isAbsolute(spec) || spec.split(/[\\/]/).includes('..')) {
    fail(`spec path is not a safe relative path: ${spec}`)
  }
  const normalized = spec.startsWith('e2e/') ? spec.slice('e2e/'.length) : spec
  if (!/^[A-Za-z0-9._/-]+\.spec\.ts$/.test(normalized)) {
    fail(`spec path must be a relative .spec.ts path: ${spec}`)
  }
  return normalized
}

function readSpecs(project: E2eProject): string[] {
  const rawSpecs = environmentValue('E2E_SPECS')
  if (!rawSpecs) {
    fail('E2E_SPECS is required')
  }
  const selectedCatalog = gates[project]
  const specs = rawSpecs.split(',').map(normalizeSpec)
  if (specs.length > maxSpecs) {
    fail(`at most ${maxSpecs} specs may be selected`)
  }
  const seen = new Set<string>()
  for (const spec of specs) {
    if (seen.has(spec)) {
      fail(`duplicate spec path: ${spec}`)
    }
    if (!selectedCatalog.includes(spec)) {
      fail(`${spec} is not in the ${project} project catalog`)
    }
    seen.add(spec)
  }
  return specs
}

function readGrep(): string {
  const grep = environmentValue('E2E_GREP')
  if (!grep) {
    return ''
  }
  if (grep.length > maxGrepLength) {
    fail(`E2E_GREP must be at most ${maxGrepLength} characters`)
  }
  try {
    new RegExp(grep)
  } catch {
    fail('E2E_GREP must be a valid JavaScript regular expression')
  }
  return grep
}

if (process.env.NOOK_REMOTE_E2E_DEBUG !== '1') {
  fail(
    'this runner is hosted-only; use the allowlisted remote web:e2e:debug task',
  )
}

const project = readProject()
const specs = readSpecs(project)
readGrep()

if (process.env.NOOK_E2E_DEBUG_SELF_CHECK === '1') {
  console.log(`E2E debug selection valid: ${project} / ${specs.join(', ')}`)
  process.exit(0)
}

const child = Bun.spawn(
  [
    'bun',
    'x',
    'playwright',
    'test',
    '--config=playwright.config.ts',
    '--workers=1',
    '--trace=retain-on-failure',
  ],
  {
    cwd: appRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  },
)

process.exit(await child.exited)
