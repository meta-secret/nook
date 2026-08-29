const assert = require('node:assert/strict')
const { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { delimiter, join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const repositoryRoot = resolve(__dirname, '../..')
const publisherPath = join(__dirname, 'workbench-publish.cjs')

function plan(gizmoId, frontmatterGizmoId = gizmoId) {
  return `---
title: "Publisher validation"
feature: publisher-validation
issue: null
gizmo_id: ${frontmatterGizmoId}
started_at: 2026-08-29T00:00:00Z
agent: codex
---

# Task plan

## Interpreted request

Validate interactive plan publication.

## Requirements

- Bind published metadata to the plan body.

## Constraints and exclusions

- Keep the test local.

## Change budget and PR sequence

- Mission controller: Gizmo Prime
- Current Gizmo ID: ${gizmoId}
- Estimated authored changed lines: 20
- Owning modules, packages, or layers: Workbench publisher
- Ownership units:
1. Capability: Plan publication; Gizmo ID: ${gizmoId}; Functional owner: AI; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Publisher tests pass
- Public or cross-module interfaces: Interactive Workbench publication
- Delivery shape: One PR
- PR sequence mode: One PR
- Current PR estimated authored changed lines: 20
- Current PR slice and acceptance evidence: Publisher validation; Acceptance evidence: Publisher tests pass
- PR slices, estimates, and acceptance evidence:
1. Gizmo ID: ${gizmoId}; Gizmo name: Publisher; Predecessor Gizmo ID: None; Publisher validation; Estimated authored changed lines: 20; Acceptance evidence: Publisher tests pass

## Initial plan

1. Validate the publication boundary.

## Completion evidence

- Publisher tests pass.

## Safety review

- Contains public-safe test data.
`
}

function publish(candidate, assignedGizmoId = '') {
  const scratch = mkdtempSync(join(tmpdir(), 'nook-workbench-publish-'))
  const binDirectory = join(scratch, 'bin')
  const localPlan = join(scratch, 'plan.md')
  const sourceTask = join(scratch, 'source-task.md')
  const ghCalls = join(scratch, 'gh-calls.jsonl')
  require('node:fs').mkdirSync(binDirectory)
  const ghPath = join(binDirectory, 'gh')
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
appendFileSync(process.env.GH_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n')
process.exit(process.argv.includes('PUT') ? 0 : 1)
`,
  )
  chmodSync(ghPath, 0o755)
  writeFileSync(localPlan, candidate)
  writeFileSync(sourceTask, 'Privately supplied publisher validation task.')
  writeFileSync(ghCalls, '')

  const result = spawnSync(
    process.execPath,
    [publisherPath, localPlan, 'plans/tests/publisher-validation.md', 'test: publish plan'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GH_CALLS: ghCalls,
        NOOK_WORKBENCH_ASSIGNED_GIZMO_ID: assignedGizmoId,
        NOOK_WORKBENCH_SOURCE_TASK_FILE: sourceTask,
        PATH: `${binDirectory}${delimiter}${process.env.PATH || ''}`,
      },
    },
  )
  const calls = readFileSync(ghCalls, 'utf8')
  rmSync(scratch, { recursive: true, force: true })
  return { result, calls }
}

test('publishes a direct plan whose frontmatter matches its validated body ID', () => {
  const { result, calls } = publish(plan('2fa-slice'))
  assert.equal(result.status, 0, result.stderr)
  assert.match(calls, /"PUT"/)
})

test('publishes a trusted focused-issue plan with one matching ID', () => {
  const { result, calls } = publish(plan('focused-slice'), 'focused-slice')
  assert.equal(result.status, 0, result.stderr)
  assert.match(calls, /"PUT"/)
})

test('rejects a concrete frontmatter and body Gizmo ID mismatch', () => {
  const { result, calls } = publish(
    plan('body-slice', 'other-slice'),
    'body-slice',
  )
  assert.equal(result.status, 7)
  assert.match(result.stderr, /gizmo_id must match the validated Current Gizmo ID/)
  assert.equal(calls, '')
})

test('rejects a null plan frontmatter Gizmo ID', () => {
  const { result, calls } = publish(plan('body-slice', 'null'))
  assert.equal(result.status, 7)
  assert.match(result.stderr, /YAML frontmatter gizmo_id is invalid/)
  assert.equal(calls, '')
})
