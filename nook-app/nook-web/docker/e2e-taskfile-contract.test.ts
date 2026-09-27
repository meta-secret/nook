import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

const dockerTaskfile = readFileSync(
  resolve(import.meta.dir, 'Taskfile.yml'),
  'utf8',
)
const extensionTaskfile = readFileSync(
  resolve(import.meta.dir, '../nook-web-extension/Taskfile.yml'),
  'utf8',
)

function taskBlock(taskfile: string, name: string) {
  const header = `  ${name}:\n`
  const start = taskfile.indexOf(header)
  if (start === -1) {
    throw new Error(`Taskfile target ${name} is missing`)
  }

  const bodyStart = start + header.length
  const remaining = taskfile.slice(bodyStart)
  const nextTarget = remaining.search(/^  [A-Za-z0-9:_-]+:$/m)
  return remaining.slice(0, nextTarget === -1 ? remaining.length : nextTarget)
}

const dockerE2eTarget = taskBlock(dockerTaskfile, 'docker:e2e:run')
const extensionFileTarget = taskBlock(
  extensionTaskfile,
  'extension:test:e2e:file',
)

test('the Extension E2E Task selection reaches the Docker container explicitly', () => {
  expect(extensionFileTarget).toContain('E2E_SPEC: \'{{env "E2E_SPEC"}}\'')
  expect(extensionFileTarget).toContain('task: docker:e2e:run')
  expect(extensionFileTarget).toContain('TASK: _extension:test:e2e:file')
  expect(extensionFileTarget).toContain("E2E_SPEC: '{{.E2E_SPEC}}'")
  expect(dockerE2eTarget).toContain("E2E_SPEC: '{{.E2E_SPEC}}'")
  expect(dockerE2eTarget).toMatch(/^\s*-e E2E_SPEC\s+\\$/m)
  expect(dockerE2eTarget).not.toContain('-e E2E_SPEC="{{.E2E_SPEC}}"')
})
