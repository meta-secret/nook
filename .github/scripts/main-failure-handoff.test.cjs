const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  buildMainFailureIssue,
  incidentPathForRun,
  requireMainFailure,
} = require('./main-failure-handoff.cjs')

function run(overrides = {}) {
  return {
    id: 30190000000,
    run_attempt: 1,
    name: 'Main',
    event: 'push',
    head_branch: 'main',
    head_sha: 'abcdef0123456789abcdef0123456789abcdef01',
    conclusion: 'failure',
    html_url: 'https://github.com/meta-secret/nook/actions/runs/30190000000',
    ...overrides,
  }
}

test('creates one ready automated incident per failed Main revision', () => {
  const source = run()
  const issue = buildMainFailureIssue({
    run: source,
    jobs: [
      { name: 'Native Rust verification', conclusion: 'success' },
      { name: 'WASM verification and artifact', conclusion: 'failure' },
      { name: 'Deploy development', conclusion: 'skipped' },
    ],
    sourcePullRequests: [{ number: 786 }, { number: 786 }],
    recordedAt: '2026-07-26T06:00:00Z',
  })

  assert.equal(issue.path, incidentPathForRun(source))
  assert.match(issue.body, /^status: ready$/m)
  assert.match(issue.body, /^automation: hive$/m)
  assert.match(issue.body, /^related_prs: \[786\]$/m)
  assert.match(issue.body, /Failed jobs: WASM verification and artifact\./)
  assert.doesNotMatch(issue.body, /raw log contents/)
})

test('deduplicates attempts and preserves an active claim', () => {
  const source = run()
  const initial = buildMainFailureIssue({
    run: source,
    jobs: [{ name: 'Verify web build', conclusion: 'failure' }],
    recordedAt: '2026-07-26T06:00:00Z',
  })
  const claimed = initial.body
    .replace(/^status: ready$/m, 'status: in_progress')
    .replace(/^owner: unassigned$/m, 'owner: hive-worker-1')

  const rerun = run({ run_attempt: 2 })
  const updated = buildMainFailureIssue({
    run: rerun,
    jobs: [{ name: 'Web e2e', conclusion: 'timed_out' }],
    sourcePullRequests: [{ number: 790 }],
    recordedAt: '2026-07-26T06:30:00Z',
    existingBody: claimed,
  })
  const duplicate = buildMainFailureIssue({
    run: rerun,
    jobs: [{ name: 'Web e2e', conclusion: 'timed_out' }],
    sourcePullRequests: [{ number: 790 }],
    recordedAt: '2026-07-26T06:30:00Z',
    existingBody: updated.body,
  })

  assert.match(updated.body, /^status: in_progress$/m)
  assert.match(updated.body, /^owner: hive-worker-1$/m)
  assert.match(updated.body, /^related_prs: \[790\]$/m)
  assert.equal(
    duplicate.body.match(/<!-- main-run:30190000000:attempt:2 -->/g)?.length,
    1,
  )
})

test('records a later failed rerun without reopening a completed incident', () => {
  const source = run()
  const initial = buildMainFailureIssue({
    run: source,
    jobs: [{ name: 'Verify web build', conclusion: 'failure' }],
    recordedAt: '2026-07-26T06:00:00Z',
  })
  const completed = initial.body
    .replace(/^status: ready$/m, 'status: done')
    .replace(/^owner: unassigned$/m, 'owner: hive-worker-1')
  const updated = buildMainFailureIssue({
    run: run({ run_attempt: 2 }),
    jobs: [{ name: 'Verify web build', conclusion: 'failure' }],
    recordedAt: '2026-07-26T07:00:00Z',
    existingBody: completed,
  })

  assert.match(updated.body, /^status: done$/m)
  assert.match(updated.body, /^owner: hive-worker-1$/m)
  assert.match(updated.body, /<!-- main-run:30190000000:attempt:2 -->/)
})

test('rejects untrusted or non-failing workflow shapes', () => {
  assert.equal(
    requireMainFailure(run({ conclusion: 'timed_out' })),
    'abcdef0123456789abcdef0123456789abcdef01',
  )
  assert.throws(
    () => requireMainFailure(run({ event: 'pull_request' })),
    /expected push event/,
  )
  assert.throws(
    () => requireMainFailure(run({ conclusion: 'cancelled' })),
    /expected unsuccessful conclusion/,
  )
  assert.throws(
    () => requireMainFailure(run({ head_branch: 'feature' })),
    /expected main branch/,
  )
})

test('workflow preserves the Main cache order and coalesces only pending runs', () => {
  const root = path.join(__dirname, '..', '..')
  const main = fs.readFileSync(path.join(root, '.github/workflows/main.yml'), 'utf8')
  assert.match(
    main,
    /concurrency:\n\s+group: main[\s\S]*cancel-in-progress: false/,
  )
  assert.doesNotMatch(main, /^\s+queue:/m)
  assert.match(main, /wasm:\n\s+name: WASM verification and artifact[\s\S]*needs: \[rust\]/)
  assert.match(
    main,
    /Publish verified native BuildKit cache[\s\S]*task ci:main:publish-native-cache/,
  )
  assert.match(
    main,
    /Publish verified WASM BuildKit cache[\s\S]*task ci:main:publish-wasm-cache/,
  )
})

test('handoff workflow trusts default-branch code and writes only Workbench', () => {
  const root = path.join(__dirname, '..', '..')
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/main-failure-handoff.yml'),
    'utf8',
  )
  assert.match(
    workflow,
    /workflow_run:\n\s+workflows: \[Main\]\n\s+types: \[completed\]\n\s+branches: \[main\]/,
  )
  assert.match(workflow, /"action_required","failure","startup_failure","timed_out"/)
  assert.doesNotMatch(workflow, /^\s+queue:/m)
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/)
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.match(workflow, /github-token: \$\{\{ secrets\.NOOK_GITHUB_PAT \}\}/)
  assert.match(workflow, /WORKBENCH_REPOSITORY: meta-secret\/nook-workbench/)
  assert.doesNotMatch(workflow, /download-artifact|log-failed|issues\.create/)
})
