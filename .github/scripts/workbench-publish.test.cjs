/** @type {typeof import('node:assert/strict')} */
const assert = /** @type {typeof import('node:assert/strict')} */ (
  process.getBuiltinModule('node:assert/strict')
)
/** @type {typeof import('node:fs')} */
const fs = /** @type {typeof import('node:fs')} */ (
  process.getBuiltinModule('node:fs')
)
/** @type {typeof import('node:os')} */
const os = /** @type {typeof import('node:os')} */ (
  process.getBuiltinModule('node:os')
)
/** @type {typeof import('node:path')} */
const path = /** @type {typeof import('node:path')} */ (
  process.getBuiltinModule('node:path')
)
/** @type {typeof import('node:child_process')} */
const childProcess = /** @type {typeof import('node:child_process')} */ (
  process.getBuiltinModule('node:child_process')
)
/** @type {typeof import('node:test')} */
const test = /** @type {typeof import('node:test')} */ (
  process.getBuiltinModule('node:test')
)

const WorkbenchRemoteShaOverrideKind = Object.freeze({
  NotConfigured: 'not-configured',
  Configured: 'configured',
})
/** @typedef {{ kind: typeof WorkbenchRemoteShaOverrideKind.NotConfigured } | { kind: typeof WorkbenchRemoteShaOverrideKind.Configured, sha: string }} WorkbenchRemoteShaOverride */

const WorkbenchExpectedShaOverrideKind = Object.freeze({
  NotConfigured: 'not-configured',
  Configured: 'configured',
})
/** @typedef {{ kind: typeof WorkbenchExpectedShaOverrideKind.NotConfigured } | { kind: typeof WorkbenchExpectedShaOverrideKind.Configured, sha: string }} WorkbenchExpectedShaOverride */

/** @type {WorkbenchRemoteShaOverride} */
const remoteShaNotConfigured = {
  kind: WorkbenchRemoteShaOverrideKind.NotConfigured,
}
/** @type {WorkbenchExpectedShaOverride} */
const expectedShaNotConfigured = {
  kind: WorkbenchExpectedShaOverrideKind.NotConfigured,
}

const { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = fs
const { tmpdir } = os
const { delimiter, join, resolve } = path
const { spawnSync } = childProcess
const repositoryRoot = resolve(__dirname, '../..')
const publisherPath = join(__dirname, 'workbench-publish.cjs')
const issueContent = [
  '# Focused issue',
  '',
  'This issue is safe to publish.',
  '',
].join(String.fromCharCode(10))

class WorkbenchPublisherHarness {
  /** @param {{ remotePath: string, remoteSha: WorkbenchRemoteShaOverride, expectedSha: WorkbenchExpectedShaOverride }} options */
  constructor({ remotePath, remoteSha, expectedSha }) {
    const inheritedEnv = { ...process.env }
    delete inheritedEnv.NOOK_WORKBENCH_EXPECTED_SHA
    delete inheritedEnv.REMOTE_SHA
    this.remoteSha = remoteSha
    this.expectedSha = expectedSha
    this.remotePath = remotePath
    this.scratch = mkdtempSync(join(tmpdir(), 'nook-workbench-publish-'))
    this.binDirectory = join(this.scratch, 'bin')
    this.localPath = join(this.scratch, 'issue.md')
    this.ghCalls = join(this.scratch, 'gh-calls.jsonl')
    this.ghPath = join(this.binDirectory, 'gh')
    this.inheritedEnv = inheritedEnv

    fs.mkdirSync(this.binDirectory)
    writeFileSync(
      this.ghPath,
      `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(process.env.GH_CALLS, JSON.stringify(args) + String.fromCharCode(10))
if (args.includes('PUT')) process.exit(0)
if (Object.hasOwn(process.env, 'REMOTE_SHA')) {
  process.stdout.write(process.env.REMOTE_SHA)
  process.exit(0)
}
process.exit(1)
`,
    )
    chmodSync(this.ghPath, 0o755)
    writeFileSync(this.localPath, issueContent)
    writeFileSync(this.ghCalls, '')
  }

  run() {
    const expectedShaEnvironment =
      this.expectedSha.kind === WorkbenchExpectedShaOverrideKind.Configured
        ? { NOOK_WORKBENCH_EXPECTED_SHA: this.expectedSha.sha }
        : {}
    const remoteShaEnvironment =
      this.remoteSha.kind === WorkbenchRemoteShaOverrideKind.Configured
        ? { REMOTE_SHA: this.remoteSha.sha }
        : {}
    let inheritedPath = ''
    for (const [name, value] of Object.entries(process.env)) {
      if (name === 'PATH' && typeof value === 'string') inheritedPath = value
    }

    const result = spawnSync(
      process.execPath,
      [publisherPath, this.localPath, this.remotePath, 'test: publish issue'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...this.inheritedEnv,
          GH_CALLS: this.ghCalls,
          NOOK_WORKBENCH_REPOSITORY: 'meta-secret/nook-workbench',
          ...expectedShaEnvironment,
          ...remoteShaEnvironment,
          PATH: `${this.binDirectory}${delimiter}${inheritedPath}`,
        },
      },
    )
    const calls = readFileSync(this.ghCalls, 'utf8')
    return { result, calls }
  }

  dispose() {
    rmSync(this.scratch, { recursive: true, force: true })
  }
}

void test('publishes a Workbench issue', () => {
  const harness = new WorkbenchPublisherHarness({
    remotePath: 'issues/focused/one.md',
    remoteSha: remoteShaNotConfigured,
    expectedSha: expectedShaNotConfigured,
  })
  try {
    const { result, calls } = harness.run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(calls, /"PUT"/)
    assert.match(calls, /contents\/issues\/focused\/one\.md/)
    assert.match(calls, /message=test: publish issue/)
  } finally {
    harness.dispose()
  }
})

for (const remotePath of [
  'plans/focused.md',
  'worklogs/focused.md',
  'stats/main-build/attempt.yaml',
  'issues/../outside.md',
]) {
  void test('rejects non-issue Workbench destination ' + remotePath, () => {
    const harness = new WorkbenchPublisherHarness({
      remotePath,
      remoteSha: remoteShaNotConfigured,
      expectedSha: expectedShaNotConfigured,
    })
    try {
      const { result, calls } = harness.run()
      assert.equal(result.status, 2, result.stderr)
      assert.match(result.stderr, /Refusing invalid Workbench issue path/)
      assert.equal(calls, '')
    } finally {
      harness.dispose()
    }
  })
}

void test('requires the expected SHA before replacing an issue', () => {
  const harness = new WorkbenchPublisherHarness({
    remotePath: 'issues/focused/one.md',
    remoteSha: {
      kind: WorkbenchRemoteShaOverrideKind.Configured,
      sha: 'current-sha',
    },
    expectedSha: expectedShaNotConfigured,
  })
  try {
    const { result, calls } = harness.run()
    assert.equal(result.status, 4, result.stderr)
    assert.doesNotMatch(calls, /"PUT"/)
  } finally {
    harness.dispose()
  }
})

void test('updates an issue when the expected SHA matches', () => {
  const harness = new WorkbenchPublisherHarness({
    remotePath: 'issues/focused/one.md',
    remoteSha: {
      kind: WorkbenchRemoteShaOverrideKind.Configured,
      sha: 'current-sha',
    },
    expectedSha: {
      kind: WorkbenchExpectedShaOverrideKind.Configured,
      sha: 'current-sha',
    },
  })
  try {
    const { result, calls } = harness.run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(calls, /sha=current-sha/)
  } finally {
    harness.dispose()
  }
})

void test('rejects an issue update with a stale expected SHA', () => {
  const harness = new WorkbenchPublisherHarness({
    remotePath: 'issues/focused/one.md',
    remoteSha: {
      kind: WorkbenchRemoteShaOverrideKind.Configured,
      sha: 'current-sha',
    },
    expectedSha: {
      kind: WorkbenchExpectedShaOverrideKind.Configured,
      sha: 'stale-sha',
    },
  })
  try {
    const { result, calls } = harness.run()
    assert.equal(result.status, 5, result.stderr)
    assert.doesNotMatch(calls, /"PUT"/)
  } finally {
    harness.dispose()
  }
})
