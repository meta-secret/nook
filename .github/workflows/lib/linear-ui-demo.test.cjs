/** @type {(moduleName: string) => unknown} */
const loadBuiltin = /** @type {(moduleName: string) => unknown} */ (process.getBuiltinModule.bind(process))
/** @type {typeof import('node:assert/strict')} */
const assert = /** @type {typeof import('node:assert/strict')} */ (loadBuiltin('node:assert/strict'))
/** @type {typeof import('node:fs/promises')} */
const fs = /** @type {typeof import('node:fs/promises')} */ (loadBuiltin('node:fs/promises'))
/** @type {typeof import('node:os')} */
const os = /** @type {typeof import('node:os')} */ (loadBuiltin('node:os'))
/** @type {typeof import('node:path')} */
const path = /** @type {typeof import('node:path')} */ (loadBuiltin('node:path'))
/** @type {typeof import('node:test')} */
const test = /** @type {typeof import('node:test')} */ (loadBuiltin('node:test'))

/** @template T @param {string} modulePath @returns {T} */
function loadModule(modulePath) {
  const loaded = /** @type {unknown} */ (module.require(modulePath))
  return /** @type {T} */ (loaded)
}

/** @typedef {{ id: string, identifier?: string, url?: string, comments: { nodes: Array<{ id: string, body: string }> } }} TestIssue */
/** @typedef {{ id: string, type: string }} TestState */
/** @typedef {{ id: string, description: string, labelIds: string[], projectId: string, stateId: string, teamId: string, title: string }} CreateInput */
/** @typedef {{ stateId: string }} UpdateInput */
/** @typedef {{ body: string, issueId: string }} CommentInput */
/** @typedef {{ kind: 'create', input: CreateInput } | { kind: 'upload', file: string, filename: string } | { kind: 'comment', input: CommentInput }} CreateCall */
/** @typedef {{ kind: 'update', id: string, input: UpdateInput } | { kind: 'unexpected-upload' }} UpdateCall */
/** @typedef {{ deterministicIssueId: (repository: string, prNumber: number) => string, findWebmFiles: (root: string) => Promise<string[]>, selectLargestWebmFiles: (root: string, limit: number) => Promise<{ files: string[], total: number }>, stateByType: (states: TestState[], type: string) => TestState, syncUiDemoIssue: (input: unknown) => Promise<TestIssue>, transitionUiDemoIssue: (input: unknown) => Promise<unknown>, UiDemoIssueTransitionKind: { IssueAbsent: string, Updated: string } }} TestLinearModule */
/** @type {TestLinearModule} */
const linear = loadModule('./linear-ui-demo.cjs')
const {
  deterministicIssueId,
  findWebmFiles,
  selectLargestWebmFiles,
  stateByType,
  syncUiDemoIssue,
  transitionUiDemoIssue,
  UiDemoIssueTransitionKind,
} = linear

const config = {
  labelId: 'label-id',
  projectId: 'project-id',
  repository: 'meta-secret/nook',
  teamId: 'team-id',
}

const pullRequest = {
  headSha: '1234567890abcdef1234567890abcdef12345678',
  number: 603,
  runUrl: 'https://github.com/meta-secret/nook/actions/runs/1',
  specs: 'example.demo.spec.ts',
  title: 'Connect extension',
  url: 'https://github.com/meta-secret/nook/pull/603',
}

void test('derives a stable UUID v4 from the repository and PR number', () => {
  const first = deterministicIssueId('meta-secret/nook', 603)
  assert.equal(first, deterministicIssueId('meta-secret/nook', 603))
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(first, deterministicIssueId('meta-secret/nook', 604))
})

void test('finds only WebM videos recursively in deterministic order', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nook-linear-ui-demo-'))
  await fs.mkdir(path.join(root, 'nested'))
  await Promise.all([
    fs.writeFile(path.join(root, 'z.webm'), 'z'),
    fs.writeFile(path.join(root, 'nested', 'a.WEBM'), 'a'),
    fs.writeFile(path.join(root, 'trace.zip'), 'trace'),
  ])

  const files = await findWebmFiles(root)
  assert.deepEqual(
    files.map((file) => path.relative(root, file)),
    ['nested/a.WEBM', 'z.webm'],
  )
})

void test('selects the largest WebM videos with path order as a stable tie-breaker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nook-linear-ui-demo-'))
  await Promise.all([
    fs.writeFile(path.join(root, 'a.webm'), 'same'),
    fs.writeFile(path.join(root, 'b.webm'), 'largest'),
    fs.writeFile(path.join(root, 'c.webm'), 'same'),
  ])

  const selection = await selectLargestWebmFiles(root, 2)
  assert.equal(selection.total, 3)
  assert.deepEqual(
    selection.files.map((file) => path.basename(file)),
    ['b.webm', 'a.webm'],
  )
})

void test('creates one issue and one embedded-video comment for a new PR', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nook-linear-ui-demo-'))
  await fs.writeFile(path.join(root, 'video.webm'), 'video')
  /** @type {CreateCall[]} */
  const calls = []
  const client = {
    async teamStates() {
      await Promise.resolve()
      return [{ id: 'started-id', type: 'started' }]
    },
    async issue() {
      await Promise.resolve()
      return
    },
    async createIssue(/** @type {CreateInput} */ input) {
      await Promise.resolve()
      calls.push({ kind: 'create', input })
      return { id: input.id, identifier: 'MET-1', url: 'https://linear.app/meta-secret/issue/MET-1', comments: { nodes: [] } }
    },
    async uploadFile(/** @type {string} */ file, /** @type {string} */ filename) {
      await Promise.resolve()
      calls.push({ kind: 'upload', file: path.basename(file), filename })
      return { assetUrl: 'https://uploads.linear.app/video', filename: 'video.webm' }
    },
    async createComment(/** @type {CommentInput} */ input) {
      await Promise.resolve()
      calls.push({ kind: 'comment', input })
    },
  }

  const issue = await syncUiDemoIssue({ client, config, demoDir: root, pullRequest })

  assert.equal(issue.identifier, 'MET-1')
  const createCall = calls[0]
  const uploadCall = calls[1]
  const commentCall = calls[2]
  if (!createCall || createCall.kind !== 'create') throw new Error('missing create call')
  if (!uploadCall || uploadCall.kind !== 'upload') throw new Error('missing upload call')
  if (!commentCall || commentCall.kind !== 'comment') throw new Error('missing comment call')
  assert.equal(createCall.input.projectId, 'project-id')
  assert.deepEqual(createCall.input.labelIds, ['label-id'])
  assert.deepEqual(uploadCall, { kind: 'upload', file: 'video.webm', filename: 'video.webm' })
  assert.match(commentCall.input.body, /Linear selection: 1 largest of 1 recorded videos/)
  assert.match(commentCall.input.body, /!\[video\.webm\]\(https:\/\/uploads\.linear\.app\/video\)/)
})

void test('uploads only the configured number of largest videos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nook-linear-ui-demo-'))
  await Promise.all([
    fs.writeFile(path.join(root, 'small.webm'), '1'),
    fs.writeFile(path.join(root, 'medium.webm'), '12'),
    fs.writeFile(path.join(root, 'large.webm'), '123'),
  ])
  /** @type {string[]} */
  const uploads = []
  let commentBody = ''
  const client = {
    async teamStates() {
      await Promise.resolve()
      return [{ id: 'started-id', type: 'started' }]
    },
    async issue() { await Promise.resolve() },
    async createIssue(/** @type {CreateInput} */ input) {
      await Promise.resolve()
      return { id: input.id, comments: { nodes: [] } }
    },
    async uploadFile(/** @type {string} */ file, /** @type {string} */ filename) {
      await Promise.resolve()
      uploads.push(path.basename(file))
      return { assetUrl: `https://uploads.linear.app/${filename}`, filename }
    },
    async createComment(/** @type {CommentInput} */ { body }) {
      await Promise.resolve()
      commentBody = body
    },
  }

  await syncUiDemoIssue({ client, config, demoDir: root, maxVideos: 2, pullRequest })

  assert.deepEqual(uploads, ['large.webm', 'medium.webm'])
  assert.match(commentBody, /Linear selection: 2 largest of 3 recorded videos/)
  assert.doesNotMatch(commentBody, /small\.webm/)
})

void test('updates the existing issue without re-uploading an already published head', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nook-linear-ui-demo-'))
  await fs.writeFile(path.join(root, 'video.webm'), 'video')
  /** @type {UpdateCall[]} */
  const calls = []
  const marker = `<!-- nook-ui-demo-head:${pullRequest.headSha} -->`
  const client = {
    async teamStates() {
      await Promise.resolve()
      return [{ id: 'started-id', type: 'started' }]
    },
    async issue() {
      await Promise.resolve()
      return { id: 'issue-id', comments: { nodes: [{ id: 'comment-id', body: `${marker}\nold` }] } }
    },
    async updateIssue(/** @type {string} */ id, /** @type {UpdateInput} */ input) {
      await Promise.resolve()
      calls.push({ kind: 'update', id, input })
      return { id, identifier: 'MET-1', url: 'https://linear.app/meta-secret/issue/MET-1', comments: { nodes: [{ id: 'comment-id', body: `${marker}\nold` }] } }
    },
    async uploadFile() {
      await Promise.resolve()
      calls.push({ kind: 'unexpected-upload' })
    },
  }

  await syncUiDemoIssue({ client, config, demoDir: root, pullRequest })

  const updateCall = calls[0]
  if (!updateCall || updateCall.kind !== 'update') throw new Error('missing update call')
  assert.equal(calls.length, 1)
})

void test('moves an existing issue to completed or canceled and ignores absent issues', async () => {
  /** @type {Array<[string, UpdateInput]>} */
  const updates = []
  const client = {
    async issue() {
      await Promise.resolve()
      return { id: 'issue-id' }
    },
    async teamStates() {
      await Promise.resolve()
      return [
        { id: 'done-id', type: 'completed' },
        { id: 'canceled-id', type: 'canceled' },
      ]
    },
    async updateIssue(/** @type {string} */ id, /** @type {UpdateInput} */ input) {
      await Promise.resolve()
      updates.push([id, input])
      return { id }
    },
  }

  await transitionUiDemoIssue({ client, config, merged: true, prNumber: 603 })
  await transitionUiDemoIssue({ client, config, merged: false, prNumber: 603 })
  assert.deepEqual(updates, [
    [deterministicIssueId(config.repository, 603), { stateId: 'done-id' }],
    [deterministicIssueId(config.repository, 603), { stateId: 'canceled-id' }],
  ])

  const missing = await transitionUiDemoIssue({
    client: { async issue() { await Promise.resolve() } },
    config,
    merged: true,
    prNumber: 999,
  })
  assert.deepEqual(missing, {
    kind: UiDemoIssueTransitionKind.IssueAbsent,
  })
})

void test('requires the requested workflow state type', () => {
  assert.throws(() => stateByType([], 'completed'), /no completed workflow state/)
})

void test('keeps the Linear credential out of the untrusted pull request workflow', async () => {
  const workflows = path.join(__dirname, '..')
  const [pullRequestWorkflow, trustedWorkflow] = await Promise.all([
    fs.readFile(path.join(workflows, 'pr.yml'), 'utf8'),
    fs.readFile(path.join(workflows, 'linear-ui-demo.yml'), 'utf8'),
  ])

  assert.doesNotMatch(pullRequestWorkflow, /LINEAR_API_KEY/)
  assert.doesNotMatch(pullRequestWorkflow, /types: \[labeled, closed\]/)
  assert.match(trustedWorkflow, /workflow_run:/)
  assert.match(trustedWorkflow, /pull_request_target:/)
  assert.match(
    trustedWorkflow,
    /group: linear-ui-demo-\$\{\{ github\.run_id \}\}/,
  )
  assert.match(trustedWorkflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
})
