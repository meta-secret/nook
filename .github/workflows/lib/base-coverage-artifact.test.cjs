/** @type {(moduleName: string) => unknown} */
const loadBuiltin = /** @type {(moduleName: string) => unknown} */ (process.getBuiltinModule.bind(process))
/** @type {typeof import('node:assert/strict')} */
const assert = /** @type {typeof import('node:assert/strict')} */ (loadBuiltin('node:assert/strict'))
/** @type {typeof import('node:test')} */
const test = /** @type {typeof import('node:test')} */ (loadBuiltin('node:test'))

/** @template T @param {string} modulePath @returns {T} */
function loadModule(modulePath) {
  const loaded = /** @type {unknown} */ (module.require(modulePath))
  return /** @type {T} */ (loaded)
}

/** @typedef {{ Found: 'found', Unavailable: 'unavailable' }} CoverageKinds */
/** @typedef {{ kind: 'found', artifact: { artifactId: number, runId: number } } | { kind: 'unavailable' }} CoverageResult */
/** @typedef {{ BaseCoverageArtifactKind: CoverageKinds, coverageArtifactName: (sha: string) => string, findBaseCoverageArtifact: (input: { github: unknown, owner: string, repo: string, baseSha: string, defaultBranch: string }) => Promise<CoverageResult> }} CoverageModule */
/** @type {CoverageModule} */
const coverage = loadModule('./base-coverage-artifact.cjs')
const {
  BaseCoverageArtifactKind,
  coverageArtifactName,
  findBaseCoverageArtifact,
} = coverage

const BASE_SHA = '0123456789abcdef0123456789abcdef01234567'

/** @typedef {{ id: number, name: string, expired?: boolean, workflow_run?: { id?: number } }} FixtureArtifact */
/** @typedef {{ id: number, name: string, path?: string, head_branch?: string, head_sha?: string, event?: string }} FixtureRun */
/** @typedef {{ operation: 'list', options: { owner: string, repo: string, name: string, per_page: number } } | { operation: 'get', runId: number }} FixtureCall */
/** @param {{ artifacts: FixtureArtifact[], runs: Record<number, FixtureRun> }} input */
function githubFixture({ artifacts, runs }) {
  /** @type {FixtureCall[]} */
  const calls = []
  return {
    calls,
    github: {
      paginate: /** @param {unknown} _method @param {{ owner: string, repo: string, name: string, per_page: number }} options @returns {Promise<FixtureArtifact[]>} */ (_method, options) => {
        calls.push({ operation: 'list', options })
        return Promise.resolve(artifacts)
      },
      rest: {
        actions: {
          listArtifactsForRepo: Symbol('listArtifactsForRepo'),
          getWorkflowRun: /** @param {{ owner: string, repo: string, run_id: number }} input @returns {Promise<{ data: FixtureRun }>} */ (input) => {
            const runId = input.run_id
            calls.push({ operation: 'get', runId })
            const run = runs[runId]
            if (!run) throw new Error(`missing fixture run ${runId}`)
            return Promise.resolve({ data: run })
          },
        },
      },
    },
  }
}

/** @param {Partial<FixtureRun> & { status?: string, conclusion?: string }} [overrides] */
function mainRun(overrides = {}) {
  return {
    id: 41,
    name: 'CI',
    path: '.github/workflows/ci.yml@refs/heads/main',
    head_branch: 'main',
    head_sha: BASE_SHA,
    event: 'push',
    status: 'in_progress',
    ...overrides,
  }
}

void test('builds a commit-keyed coverage artifact name', () => {
  assert.equal(
    coverageArtifactName(BASE_SHA),
    `nook-core-auth-coverage-${BASE_SHA}`,
  )
  assert.throws(() => coverageArtifactName('main'), /full lowercase Git commit/)
})

void test('uses an artifact as soon as the Main Rust job publishes it', async () => {
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
  const firstCall = calls[0]
  if (!firstCall || firstCall.operation !== 'list') throw new Error('missing list call')
  assert.equal(firstCall.options.name, name)
})

void test('uses a valid Rust artifact even if a later Main job failed', async () => {
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

void test('rejects expired and untrusted workflow artifacts', async () => {
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
