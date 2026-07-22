const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  deterministicIssueId,
  findWebmFiles,
  selectLargestWebmFiles,
  stateByType,
  syncUiDemoIssue,
  transitionUiDemoIssue,
} = require('./linear-ui-demo.cjs')

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

test('derives a stable UUID v4 from the repository and PR number', () => {
  const first = deterministicIssueId('meta-secret/nook', 603)
  assert.equal(first, deterministicIssueId('meta-secret/nook', 603))
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(first, deterministicIssueId('meta-secret/nook', 604))
})

test('finds only WebM videos recursively in deterministic order', async () => {
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

test('selects the largest WebM videos with path order as a stable tie-breaker', async () => {
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

test('creates one issue and one embedded-video comment for a new PR', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nook-linear-ui-demo-'))
  await fs.writeFile(path.join(root, 'video.webm'), 'video')
  const calls = []
  const client = {
    async teamStates() {
      return [{ id: 'started-id', type: 'started' }]
    },
    async issue() {
      return undefined
    },
    async createIssue(input) {
      calls.push(['createIssue', input])
      return { id: input.id, identifier: 'MET-1', url: 'https://linear.app/meta-secret/issue/MET-1', comments: { nodes: [] } }
    },
    async uploadFile(file, filename) {
      calls.push(['uploadFile', path.basename(file), filename])
      return { assetUrl: 'https://uploads.linear.app/video', filename: 'video.webm' }
    },
    async createComment(input) {
      calls.push(['createComment', input])
    },
  }

  const issue = await syncUiDemoIssue({ client, config, demoDir: root, pullRequest })

  assert.equal(issue.identifier, 'MET-1')
  assert.equal(calls[0][0], 'createIssue')
  assert.equal(calls[0][1].projectId, 'project-id')
  assert.deepEqual(calls[0][1].labelIds, ['label-id'])
  assert.deepEqual(calls[1], ['uploadFile', 'video.webm', 'video.webm'])
  assert.match(calls[2][1].body, /Linear selection: 1 largest of 1 recorded videos/)
  assert.match(calls[2][1].body, /!\[video\.webm\]\(https:\/\/uploads\.linear\.app\/video\)/)
})

test('uploads only the configured number of largest videos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nook-linear-ui-demo-'))
  await Promise.all([
    fs.writeFile(path.join(root, 'small.webm'), '1'),
    fs.writeFile(path.join(root, 'medium.webm'), '12'),
    fs.writeFile(path.join(root, 'large.webm'), '123'),
  ])
  const uploads = []
  let commentBody = ''
  const client = {
    async teamStates() {
      return [{ id: 'started-id', type: 'started' }]
    },
    async issue() {},
    async createIssue(input) {
      return { id: input.id, comments: { nodes: [] } }
    },
    async uploadFile(file, filename) {
      uploads.push(path.basename(file))
      return { assetUrl: `https://uploads.linear.app/${filename}`, filename }
    },
    async createComment({ body }) {
      commentBody = body
    },
  }

  await syncUiDemoIssue({ client, config, demoDir: root, maxVideos: 2, pullRequest })

  assert.deepEqual(uploads, ['large.webm', 'medium.webm'])
  assert.match(commentBody, /Linear selection: 2 largest of 3 recorded videos/)
  assert.doesNotMatch(commentBody, /small\.webm/)
})

test('updates the existing issue without re-uploading an already published head', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nook-linear-ui-demo-'))
  await fs.writeFile(path.join(root, 'video.webm'), 'video')
  const calls = []
  const marker = `<!-- nook-ui-demo-head:${pullRequest.headSha} -->`
  const client = {
    async teamStates() {
      return [{ id: 'started-id', type: 'started' }]
    },
    async issue() {
      return { id: 'issue-id', comments: { nodes: [{ id: 'comment-id', body: `${marker}\nold` }] } }
    },
    async updateIssue(id, input) {
      calls.push(['updateIssue', id, input])
      return { id, identifier: 'MET-1', url: 'https://linear.app/meta-secret/issue/MET-1', comments: { nodes: [{ id: 'comment-id', body: `${marker}\nold` }] } }
    },
    async uploadFile() {
      calls.push(['unexpectedUpload'])
    },
  }

  await syncUiDemoIssue({ client, config, demoDir: root, pullRequest })

  assert.equal(calls[0][0], 'updateIssue')
  assert.equal(calls.length, 1)
})

test('moves an existing issue to completed or canceled and ignores absent issues', async () => {
  const updates = []
  const client = {
    async issue() {
      return { id: 'issue-id' }
    },
    async teamStates() {
      return [
        { id: 'done-id', type: 'completed' },
        { id: 'canceled-id', type: 'canceled' },
      ]
    },
    async updateIssue(id, input) {
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
    client: { async issue() {} },
    config,
    merged: true,
    prNumber: 999,
  })
  assert.equal(missing, undefined)
})

test('requires the requested workflow state type', () => {
  assert.throws(() => stateByType([], 'completed'), /no completed workflow state/)
})

test('keeps the Linear credential out of the untrusted pull request workflow', async () => {
  const workflows = path.join(__dirname, '..', 'workflows')
  const [pullRequestWorkflow, trustedWorkflow] = await Promise.all([
    fs.readFile(path.join(workflows, 'pr.yml'), 'utf8'),
    fs.readFile(path.join(workflows, 'linear-ui-demo.yml'), 'utf8'),
  ])

  assert.doesNotMatch(pullRequestWorkflow, /LINEAR_API_KEY/)
  assert.match(trustedWorkflow, /workflow_run:/)
  assert.match(trustedWorkflow, /pull_request_target:/)
  assert.match(trustedWorkflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
})
