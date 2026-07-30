const assert = require('node:assert/strict')
const test = require('node:test')

const {
  BaseCoverageArtifactKind,
  coverageArtifactName,
  findBaseCoverageArtifact,
} = require('./base-coverage-artifact.cjs')

const BASE_SHA = '0123456789abcdef0123456789abcdef01234567'

function githubFixture({ artifacts, runs }) {
  const calls = []
  return {
    calls,
    github: {
      paginate: async (_method, options) => {
        calls.push({ operation: 'list', options })
        return artifacts
      },
      rest: {
        actions: {
          listArtifactsForRepo: Symbol('listArtifactsForRepo'),
          getWorkflowRun: async ({ run_id: runId }) => {
            calls.push({ operation: 'get', runId })
            return { data: runs[runId] }
          },
        },
      },
    },
  }
}

function mainRun(overrides = {}) {
  return {
    id: 41,
    name: 'Main',
    path: '.github/workflows/main.yml@refs/heads/main',
    head_branch: 'main',
    head_sha: BASE_SHA,
    event: 'push',
    status: 'in_progress',
    ...overrides,
  }
}

test('builds a commit-keyed coverage artifact name', () => {
  assert.equal(
    coverageArtifactName(BASE_SHA),
    `nook-core-auth-coverage-${BASE_SHA}`,
  )
  assert.throws(() => coverageArtifactName('main'), /full lowercase Git commit/)
})

test('uses an artifact as soon as the Main Rust job publishes it', async () => {
  const name = coverageArtifactName(BASE_SHA)
  const { github, calls } = githubFixture({
    artifacts: [
      {
        id: 99,
        name,
        expired: false,
        workflow_run: { id: 41 },
      },
    ],
    runs: { 41: mainRun() },
  })

  assert.deepEqual(
    await findBaseCoverageArtifact({
      github,
      owner: 'meta-secret',
      repo: 'nook',
      baseSha: BASE_SHA,
      defaultBranch: 'main',
    }),
    {
      kind: BaseCoverageArtifactKind.Found,
      artifact: { artifactId: 99, runId: 41 },
    },
  )
  assert.equal(calls[0].options.name, name)
})

test('uses a valid Rust artifact even if a later Main job failed', async () => {
  const name = coverageArtifactName(BASE_SHA)
  const { github } = githubFixture({
    artifacts: [
      {
        id: 100,
        name,
        expired: false,
        workflow_run: { id: 42 },
      },
    ],
    runs: {
      42: mainRun({
        id: 42,
        status: 'completed',
        conclusion: 'failure',
      }),
    },
  })

  assert.deepEqual(
    await findBaseCoverageArtifact({
      github,
      owner: 'meta-secret',
      repo: 'nook',
      baseSha: BASE_SHA,
      defaultBranch: 'main',
    }),
    {
      kind: BaseCoverageArtifactKind.Found,
      artifact: { artifactId: 100, runId: 42 },
    },
  )
})

test('rejects expired and untrusted workflow artifacts', async () => {
  const name = coverageArtifactName(BASE_SHA)
  const { github } = githubFixture({
    artifacts: [
      {
        id: 102,
        name,
        expired: true,
        workflow_run: { id: 44 },
      },
      {
        id: 101,
        name,
        expired: false,
        workflow_run: { id: 43 },
      },
    ],
    runs: {
      43: mainRun({
        id: 43,
        name: 'PR',
        path: '.github/workflows/pr.yml@refs/pull/825/merge',
        head_branch: 'feature',
        event: 'pull_request',
      }),
    },
  })

  const artifact = await findBaseCoverageArtifact({
    github,
    owner: 'meta-secret',
    repo: 'nook',
    baseSha: BASE_SHA,
    defaultBranch: 'main',
  })
  assert.deepEqual(artifact, { kind: BaseCoverageArtifactKind.Unavailable })
})
