const assert = require('node:assert/strict')
const test = require('node:test')
const publisher = require('./trusted-pr-publisher.cjs')

const taskStartUrl = 'https://github.com/workbench/blob/main/plans/task.md'
const supersedingUrl = 'https://github.com/workbench/blob/main/plans/bound.md'
// prettier-ignore
const options = { currentGizmoId: "publisher-contract", markdownTitle: "Publish trusted dependency updates", now: "2026-09-02T12:00:00Z", ownerLogin: "continuing-owner", runId: 1295, runUrl: "https://github.com/nook/actions/runs/1295", taskStartUrl, supersedingUrl, title: "Publish trusted dependency updates" }

test('trusted metadata helpers preserve the manual publisher contract', () => {
  const plan =
    '1. Gizmo ID: publisher-contract ; Gizmo name: Publish: updates (Rust) ; Predecessor Gizmo ID: null'
  assert.equal(
    publisher.parseGizmoName(plan, 'publisher-contract'),
    'Publish: updates (Rust)',
  )
  assert.equal(publisher.safeCapabilityTitle('Publish trusted updates'), true)
  assert.equal(publisher.safeCapabilityTitle('unsafe\ntitle'), false)
  const issue = publisher.manualIssueRecord(options)
  // prettier-ignore
  for (const required of ["## Included scope", "## Excluded scope", taskStartUrl, supersedingUrl, "<!-- agent-implement-run:1295 -->", "gizmo_id: publisher-contract"])
    assert.ok(issue.includes(required), `manual issue is missing ${required}`)

  const body =
    '## Agent-task provenance\n\n- Run 1295\n\n## Workbench authority\n\n- Focused issue: URL'
  const worklogUrl = 'https://github.com/workbench/blob/main/worklogs/run.md'
  const updated = publisher.withWorklogUrl(body, 'worklogs/run.md', worklogUrl)
  assert.ok(updated.includes('## Agent-task provenance'))
  assert.ok(updated.includes('Focused issue: URL'))
  assert.ok(updated.includes('Immutable worklog'))
  assert.equal(
    publisher.withWorklogUrl(updated, 'worklogs/run.md', worklogUrl),
    updated,
  )
  assert.throws(() =>
    publisher.withWorklogUrl('untrusted', 'worklogs/run.md', worklogUrl),
  )
})

function repository(existing, updates) {
  // prettier-ignore
  return { rest: { repos: { getContent: async () => ({ data: { type: "file", sha: "exact-blob-sha", content: Buffer.from(existing).toString("base64") } }), createOrUpdateFileContents: async (input) => updates.push(input) } } }
}

test('same-run retry CAS-reactivates exact identity and rejects mismatch', async () => {
  const blocked = publisher
    .manualIssueRecord(options)
    .replace('status: in_progress', 'status: blocked')
  const updates = []
  // prettier-ignore
  const request = { ...options, issuePath: "issues/unplanned/run-1295.md", owner: "meta-secret", repo: "nook-workbench" }
  await publisher.establishManualIssue({
    ...request,
    github: repository(blocked, updates),
  })
  assert.equal(updates.length, 1)
  assert.equal(updates[0].sha, 'exact-blob-sha')
  const reactivated = Buffer.from(updates[0].content, 'base64').toString('utf8')
  assert.match(reactivated, /^status: in_progress$/m)
  assert.ok(reactivated.includes('reactivated this exact blocked issue'))

  const mismatch = blocked.replace(
    'owner: continuing-owner',
    'owner: another-owner',
  )
  const rejectedUpdates = []
  await assert.rejects(
    publisher.establishManualIssue({
      ...request,
      github: repository(mismatch, rejectedUpdates),
    }),
    /does not match this trusted run/,
  )
  assert.equal(rejectedUpdates.length, 0)
})
