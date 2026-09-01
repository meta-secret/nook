const assert = require('node:assert/strict')
const { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { delimiter, join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const repositoryRoot = resolve(__dirname, '../..')
const publisherPath = join(__dirname, 'workbench-publish.cjs')

function plan(gizmoId, frontmatterGizmoId = gizmoId, issuePath = 'null') {
  return `---
schema_version: 2
issue: ${issuePath}
gizmo_id: ${frontmatterGizmoId}
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
- Estimated authored additions: 20
- Estimated authored deletions (reported only): 0
- Owning modules, packages, or layers: Workbench publisher
- Ownership units:
1. Capability: Plan publication; Gizmo ID: ${gizmoId}; Functional owner: AI; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Publisher tests pass
- Public or cross-module interfaces: Interactive Workbench publication
- Delivery shape: One PR
- PR sequence mode: One PR
- Current PR estimated authored additions: 20
- Current PR estimated authored deletions (reported only): 0
- Current PR slice and acceptance evidence: Publisher validation; Acceptance evidence: Publisher tests pass
- PR slices, estimates, and acceptance evidence:
1. Gizmo ID: ${gizmoId}; Gizmo name: Publisher; Predecessor Gizmo ID: None; Publisher validation; Estimated authored additions: 20; Estimated authored deletions (reported only): 0; Acceptance evidence: Publisher tests pass

## Initial plan

1. Validate the publication boundary.

## Completion evidence

- Publisher tests pass.

## Safety review

- Contains public-safe test data.
`
}

function issue(gizmoId) {
  const field = gizmoId === '' ? '' : `gizmo_id: ${gizmoId}\n`
  return `---\ntitle: Focused issue\n${field}---\n\n# Focused issue\n`
}

function publish(candidate, { assignedGizmoId = '', assignedIssuePath = '', remoteIssue = '' } = {}) {
  const { NOOK_WORKBENCH_ASSIGNED_GIZMO_ID: _gizmo, NOOK_WORKBENCH_ASSIGNED_ISSUE_PATH: _issue, ...inheritedEnv } = process.env
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
const args = process.argv.slice(2)
appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + '\\n')
if (args.includes('PUT')) process.exit(0)
if (args[1]?.includes('/contents/issues/') && process.env.REMOTE_ISSUE) {
  process.stdout.write(process.env.REMOTE_ISSUE)
  process.exit(0)
}
process.exit(1)
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
        ...inheritedEnv,
        GH_CALLS: ghCalls,
        ...(assignedGizmoId ? { NOOK_WORKBENCH_ASSIGNED_GIZMO_ID: assignedGizmoId } : {}),
        ...(assignedIssuePath ? { NOOK_WORKBENCH_ASSIGNED_ISSUE_PATH: assignedIssuePath } : {}),
        NOOK_WORKBENCH_SOURCE_TASK_FILE: sourceTask,
        PATH: `${binDirectory}${delimiter}${process.env.PATH || ''}`,
        REMOTE_ISSUE: remoteIssue,
      },
    },
  )
  const calls = readFileSync(ghCalls, 'utf8')
  rmSync(scratch, { recursive: true, force: true })
  return { result, calls }
}

const focusedIssue = 'issues/focused.md'
for (const [name, candidate, options, status, rejection] of [
  ['publishes a direct self-contained plan', plan('2fa-slice'), {}, 0],
  ['binds an issue-backed plan to trusted caller metadata', plan('focused-slice', 'focused-slice', focusedIssue), { assignedGizmoId: 'focused-slice', assignedIssuePath: focusedIssue, remoteIssue: issue('focused-slice') }, 0],
  ['rejects a candidate-selected issue path', plan('focused-slice', 'focused-slice', 'issues/spoofed.md'), { assignedGizmoId: 'focused-slice', assignedIssuePath: focusedIssue }, 7],
  ['rejects a remote ID mismatch', plan('local-slice', 'local-slice', focusedIssue), { assignedGizmoId: 'remote-slice', assignedIssuePath: focusedIssue, remoteIssue: issue('remote-slice') }, 7],
  ['rejects an incorrect caller ID', plan('remote-slice', 'remote-slice', focusedIssue), { assignedGizmoId: 'wrong-caller-id', assignedIssuePath: focusedIssue, remoteIssue: issue('remote-slice') }, 7],
  ['accepts a legacy issue without an ID', plan('legacy-slice', 'legacy-slice', focusedIssue), { assignedIssuePath: focusedIssue, remoteIssue: issue('') }, 0],
  ['accepts a legacy issue with null ID', plan('legacy-slice', 'legacy-slice', focusedIssue), { assignedIssuePath: focusedIssue, remoteIssue: issue('null') }, 0],
  ['rejects body and frontmatter mismatch', plan('body-slice', 'other-slice'), {}, 7, /gizmo_id must match/],
  ['rejects null plan Gizmo ID', plan('body-slice', 'null'), {}, 7, /gizmo_id is invalid/],
  ['rejects absent plan schema before remote I/O', plan('body-slice').replace('schema_version: 2\n', ''), {}, 7, /requires/],
  ['rejects retired plan schema before remote I/O', plan('body-slice').replace('schema_version: 2', 'schema_version: 1'), {}, 7, /retired/],
  ['rejects unknown plan schema before remote I/O', plan('body-slice').replace('schema_version: 2', 'schema_version: 3'), {}, 7, /unsupported/],
]) {
  test(name, () => {
    const { result, calls } = publish(candidate, options)
    assert.equal(result.status, status, result.stderr)
    if (rejection) assert.match(result.stderr, rejection)
    if (options.remoteIssue && status === 0) assert.match(calls, /contents\/issues\/focused\.md\?ref=main/)
    if (status === 0) assert.match(calls, /"PUT"/)
    else assert.doesNotMatch(calls, /"PUT"/)
    if (name.endsWith('before remote I/O')) assert.equal(calls, '')
  })
}
