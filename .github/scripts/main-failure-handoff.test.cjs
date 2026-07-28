const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  buildMainFailureIssue,
  failedJobNames,
  incidentPathForRun,
  isStaleMainAttempt,
  retireSuccessfulMainIssue,
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

test('deduplicates attempts and supersedes an active claim for a new rerun', () => {
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

  assert.match(updated.body, /^status: ready$/m)
  assert.match(updated.body, /^owner: unassigned$/m)
  assert.match(updated.body, /^related_prs: \[790\]$/m)
  assert.equal(
    duplicate.body.match(/<!-- main-run:30190000000:attempt:2 -->/g)?.length,
    1,
  )
})

test('rejects stale rerun delivery before changing incident policy', () => {
  const current = buildMainFailureIssue({
    run: run({ run_attempt: 3 }),
    jobs: [{ name: 'Native Rust verification', conclusion: 'failure' }],
    recordedAt: '2026-07-26T07:00:00Z',
  })

  assert.equal(isStaleMainAttempt(current.body, run({ run_attempt: 2 })), true)
  assert.equal(isStaleMainAttempt(current.body, run({ run_attempt: 3 })), false)
  assert.equal(isStaleMainAttempt(current.body, run({ run_attempt: 4 })), false)
  assert.equal(
    isStaleMainAttempt(current.body, run({ id: 30189999999, run_attempt: 99 })),
    true,
  )
  assert.equal(
    isStaleMainAttempt(current.body, run({ id: 30190000001, run_attempt: 1 })),
    false,
  )
})

test('retires an existing incident after a successful rerun', () => {
  const initial = buildMainFailureIssue({
    run: run(),
    jobs: [{ name: 'Web e2e', conclusion: 'failure' }],
    recordedAt: '2026-07-26T06:00:00Z',
  })
  const repairedRun = run({ run_attempt: 2, conclusion: 'success' })
  const retired = retireSuccessfulMainIssue({
    body: initial.body.replace(/^status: ready$/m, 'status: in_progress'),
    run: repairedRun,
    recordedAt: '2026-07-26T07:00:00Z',
  })

  assert.match(retired, /^status: done$/m)
  assert.match(retired, /<!-- main-run:30190000000:attempt:2 -->/)
  assert.match(retired, /<!-- hive-retired:successful-rerun -->/)
})

test('reopens after repeated successful reruns without stale retirement markers', () => {
  const initial = buildMainFailureIssue({
    run: run(),
    jobs: [{ name: 'Web e2e', conclusion: 'failure' }],
    recordedAt: '2026-07-26T06:00:00Z',
  })
  const first = retireSuccessfulMainIssue({
    body: initial.body,
    run: run({ run_attempt: 2, conclusion: 'success' }),
    recordedAt: '2026-07-26T07:00:00Z',
  })
  const second = retireSuccessfulMainIssue({
    body: first,
    run: run({ run_attempt: 3, conclusion: 'success' }),
    recordedAt: '2026-07-26T08:00:00Z',
  })
  const reopened = buildMainFailureIssue({
    run: run({ run_attempt: 4 }),
    jobs: [{ name: 'Web e2e', conclusion: 'failure' }],
    recordedAt: '2026-07-26T09:00:00Z',
    existingBody: second,
  })

  assert.match(reopened.body, /^status: ready$/m)
  assert.doesNotMatch(reopened.body, /<!-- hive-retired:successful-rerun -->/)
})

test('successful rerun preserves completed delivery evidence', () => {
  const initial = buildMainFailureIssue({
    run: run(),
    jobs: [{ name: 'Web e2e', conclusion: 'failure' }],
    recordedAt: '2026-07-26T06:00:00Z',
  })
  const completed = `${initial.body
    .replace(/^status: ready$/m, 'status: done')
    .replace('- [ ]', '- [x]')}\n\n## Completion\n\n<!-- hive-delivery-complete -->\n- Repair PR: [#800](https://github.com/meta-secret/nook/pull/800)\n`
  const retired = retireSuccessfulMainIssue({
    body: completed,
    run: run({ run_attempt: 2, conclusion: 'success' }),
    recordedAt: '2026-07-26T07:00:00Z',
  })

  assert.match(retired, /<!-- hive-delivery-complete -->/)
  assert.match(retired, /Repair PR: \[#800\]/)
  assert.match(retired, /- \[x\] The failure is explained/)
})

test('reopens a completed incident for a later failed rerun', () => {
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

  assert.match(updated.body, /^status: ready$/m)
  assert.match(updated.body, /^owner: unassigned$/m)
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

test('queues failures confined to browser and UI-demo jobs', () => {
  const source = run()
  const issue = buildMainFailureIssue({
    run: source,
    jobs: [
      { name: 'Native Rust verification', conclusion: 'success' },
      { name: 'Web e2e', conclusion: 'failure' },
      { name: 'UI demos', conclusion: 'timed_out' },
      { name: 'Extension e2e', conclusion: 'failure' },
    ],
    sourcePullRequests: [{ number: 816 }],
    recordedAt: '2026-07-27T19:06:46Z',
  })

  assert.match(issue.body, /^status: ready$/m)
  assert.match(issue.body, /^automation: hive$/m)
  assert.match(issue.body, /^related_prs: \[816\]$/m)
  assert.deepEqual(issue.failedJobs, ['Extension e2e', 'UI demos', 'Web e2e'])
})

test('records cancelled jobs as repair evidence', () => {
  const issue = buildMainFailureIssue({
    run: run(),
    jobs: [
      { name: 'Native Rust verification', conclusion: 'cancelled' },
      { name: 'Web e2e', conclusion: 'failure' },
    ],
    recordedAt: '2026-07-27T19:06:46Z',
  })

  assert.deepEqual(issue.failedJobs, ['Native Rust verification', 'Web e2e'])
  assert.match(issue.body, /Failed jobs: Native Rust verification, Web e2e\./)
})

test('reopens an incident retired by the former E2E suppression policy', () => {
  const initial = buildMainFailureIssue({
    run: run(),
    jobs: [{ name: 'Native Rust verification', conclusion: 'failure' }],
    recordedAt: '2026-07-26T06:00:00Z',
  })
  const legacyRetired = `${initial.body
    .replace(/^status: ready$/m, 'status: done')
    .replace(
      '\n## Findings and decisions\n',
      '\n<!-- hive-retired:deferred-e2e -->\n\n## Findings and decisions\n',
    )
    .replace('- [ ]', '- [x]')}\n\n## Completion\n\n<!-- hive-delivery-complete -->\n- Repair PR: [#800](https://github.com/meta-secret/nook/pull/800)\n`
  const reopened = buildMainFailureIssue({
    run: run({ run_attempt: 2 }),
    jobs: [
      { name: 'Web e2e', conclusion: 'failure' },
      { name: 'UI demos', conclusion: 'failure' },
      { name: 'Extension e2e', conclusion: 'failure' },
    ],
    recordedAt: '2026-07-27T19:06:46Z',
    existingBody: legacyRetired,
  })

  assert.match(reopened.body, /^status: ready$/m)
  assert.match(reopened.body, /^owner: unassigned$/m)
  assert.doesNotMatch(reopened.body, /<!-- hive-retired:deferred-e2e -->/)
  assert.doesNotMatch(reopened.body, /<!-- hive-delivery-complete -->/)
  assert.match(reopened.body, /- \[ \] The failure is explained/)
  assert.match(reopened.body, /<!-- main-run:30190000000:attempt:2 -->/)
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
  assert.match(
    workflow,
    /"action_required","failure","startup_failure","timed_out","success"/,
  )
  assert.doesNotMatch(workflow, /^\s+queue:/m)
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/)
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.match(workflow, /github-token: \$\{\{ secrets\.NOOK_GITHUB_PAT \}\}/)
  assert.match(workflow, /WORKBENCH_REPOSITORY: meta-secret\/nook-workbench/)
  assert.match(workflow, /buildMainFailureIssue\(\{/)
  assert.doesNotMatch(workflow, /deferred-e2e-only|isDeferredE2eOnlyFailure/)
  assert.doesNotMatch(workflow, /download-artifact|log-failed|issues\.create/)
})
