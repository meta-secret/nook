import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

const taskfile = readFileSync(
  resolve(import.meta.dir, '../Taskfile.yml'),
  'utf8',
)

function taskBlock(name: string) {
  const header = `  ${name}:\n`
  const start = taskfile.indexOf(header)
  if (start === -1) {
    throw new Error(`Taskfile target ${name} is missing`)
  }

  const bodyStart = start + header.length
  const remaining = taskfile.slice(bodyStart)
  const nextTarget = remaining.search(/^ {2}[A-Za-z0-9:_-]+:$/m)
  return remaining.slice(0, nextTarget === -1 ? remaining.length : nextTarget)
}

const publicTarget = taskBlock('extension:test:e2e:file')
const internalTarget = taskBlock('_extension:test:e2e:file')
const taskfilePublicTarget = taskBlock('extension:test:taskfile')
const taskfileInternalTarget = taskBlock('_extension:test:taskfile')

test('the public focused Extension E2E target forwards one selected spec safely', () => {
  expect(publicTarget).toContain('E2E_SPEC: \'{{default "" .E2E_SPEC}}\'')
  expect(publicTarget).toContain('case "${E2E_SPEC:-}" in')
  expect(publicTarget).toContain("''|*[!A-Za-z0-9_.:-]*) exit 1 ;;")
  expect(publicTarget).toContain('*.spec.ts:*')
  expect(publicTarget).toContain('spec_name="${E2E_SPEC%:*}"')
  expect(publicTarget).toContain('line_number="${E2E_SPEC##*:}"')
  expect(publicTarget).toContain("''|*[!0-9]*) exit 1 ;;")
  expect(publicTarget).toContain('*[1-9]*) ;;')
  expect(publicTarget).toContain('task: setup:web:e2e:focused')
  expect(publicTarget).toContain('task: docker:e2e:run')
  expect(publicTarget).toContain('TASK: _extension:test:e2e:file')
  expect(publicTarget).toContain("E2E_SPEC: '{{.E2E_SPEC}}'")
  expect(publicTarget).not.toContain('docker run')
  expect(publicTarget).not.toContain('playwright')
  expect(internalTarget).toContain('bash scripts/test-e2e.sh "$E2E_SPEC"')
})

test('the public Taskfile contract target runs focused Taskfile checks', () => {
  expect(taskfilePublicTarget).toContain('TASK: _extension:test:taskfile')
  expect(taskfileInternalTarget).toContain(
    'bun test scripts/extension-e2e-taskfile.test.ts ../docker/e2e-taskfile-contract.test.ts',
  )
  expect(taskfileInternalTarget).not.toContain('scripts/test-e2e.sh')
})

test.each([
  ['empty selection', "''|*[!A-Za-z0-9_.:-]*) exit 1 ;;"],
  ['path traversal', '*[!A-Za-z0-9_.:-]*'],
  ['nested path', '*[!A-Za-z0-9_.:-]*'],
  ['shell metacharacters', '*[!A-Za-z0-9_.:-]*'],
  ['non-spec suffix', '*.spec.ts'],
  ['malformed line suffix', "''|*[!0-9]*) exit 1 ;;"],
  ['zero line suffix', '*[1-9]*) ;;'],
])('the Taskfile validation rule covers %s', (_case, rule) => {
  expect(publicTarget).toContain(rule)
})
