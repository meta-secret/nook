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
  assert.equal(
    publisher.safeCapabilityTitle('Publish 🚀 updates?! [core]'),
    true,
  )
  assert.equal(publisher.safeCapabilityTitle('unsafe\ntitle'), false)
  assert.equal(publisher.safeCapabilityTitle('x'.repeat(120)), true)
  assert.equal(publisher.safeCapabilityTitle('x'.repeat(121)), false)
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

function repository(files, calls) {
  const git = {
    getRef: async () => ({ data: { object: { sha: 'head-sha' } } }),
    getCommit: async () => ({ data: { tree: { sha: 'base-tree' } } }),
    createBlob: async (input) => {
      calls.blobs.push(input)
      return { data: { sha: `blob-${calls.blobs.length}` } }
    },
    createTree: async (input) => {
      calls.tree = input
      return { data: { sha: 'updated-tree' } }
    },
    createCommit: async (input) => {
      calls.commit = input
      return { data: { sha: 'updated-commit' } }
    },
    updateRef: async (input) => {
      calls.ref = input
    },
  }
  const getContent = async ({ path }) => {
    if (!(path in files))
      throw Object.assign(new Error('missing'), { status: 404 })
    return {
      data: {
        type: 'file',
        content: Buffer.from(files[path]).toString('base64'),
      },
    }
  }
  return { rest: { git, repos: { getContent } } }
}

function request(github) {
  // prettier-ignore
  return { ...options, github, issuePath: "issues/unplanned/run-1295.md", owner: "meta-secret", repo: "nook-workbench" }
}

test('manual issue and index publish in one exact-parent commit', async () => {
  const calls = { blobs: [] }
  const index = '---\nupdated_at: old\n---\n\n# Unplanned\n\n## Issues\n'
  await publisher.establishManualIssue(
    request(repository({ 'issues/unplanned/README.md': index }, calls)),
  )
  assert.deepEqual(calls.tree.tree.map(({ path }) => path).sort(), [
    'issues/unplanned/README.md',
    'issues/unplanned/run-1295.md',
  ])
  assert.deepEqual(calls.commit.parents, ['head-sha'])
  assert.equal(calls.ref.force, false)
  assert.ok(
    calls.blobs.some(({ content }) =>
      content.includes(
        '- [ ] [Publish trusted dependency updates](run-1295.md)',
      ),
    ),
  )
  assert.ok(
    calls.blobs.some(({ content }) =>
      content.includes('updated_at: 2026-09-02T12:00:00Z'),
    ),
  )
  const conflict = { blobs: [] }
  await assert.rejects(
    publisher.establishManualIssue(
      request(
        repository(
          {
            'issues/unplanned/README.md': `${index}\n- [ ] [Wrong](run-1295.md)`,
          },
          conflict,
        ),
      ),
    ),
    /conflicting path or title/,
  )
  assert.equal(conflict.blobs.length, 0)
})

test('same-run retry CAS-reactivates exact indexed identity and rejects mismatch', async () => {
  const blocked = publisher
    .manualIssueRecord(options)
    .replace('status: in_progress', 'status: blocked')
  const index =
    '---\nupdated_at: old\n---\n\n## Issues\n\n- [ ] [Publish trusted dependency updates](run-1295.md)\n'
  const calls = { blobs: [] }
  const files = {
    'issues/unplanned/README.md': index,
    'issues/unplanned/run-1295.md': blocked,
  }
  await publisher.establishManualIssue(request(repository(files, calls)))
  assert.deepEqual(
    calls.tree.tree.map(({ path }) => path),
    ['issues/unplanned/run-1295.md'],
  )
  const reactivated = calls.blobs[0].content
  assert.match(reactivated, /^status: in_progress$/m)
  assert.ok(reactivated.includes('reactivated this exact blocked issue'))

  const rejected = { blobs: [] }
  files['issues/unplanned/run-1295.md'] = blocked.replace(
    'owner: continuing-owner',
    'owner: another-owner',
  )
  await assert.rejects(
    publisher.establishManualIssue(request(repository(files, rejected))),
    /does not match this trusted run/,
  )
  assert.equal(rejected.blobs.length, 0)
})
