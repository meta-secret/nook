const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

/** @typedef {{ id: string, type: string }} LinearWorkflowState */
/** @typedef {{ id: string, body: string }} LinearComment */
/** @typedef {{ id: string, identifier?: string, title?: string, url?: string, comments: { nodes: LinearComment[] } }} LinearIssue */
/** @typedef {{ labelId: string, projectId: string, repository: string, teamId: string }} UiDemoConfig */
/** @typedef {{ headSha: string, number: number, runUrl: string, specs: string, title: string, url: string }} PullRequestInfo */
/** @typedef {{ assetUrl: string, filename: string }} UploadedVideo */
/** @typedef {{ repository: string, prNumber: number, prTitle: string, prUrl: string }} IssueDescriptionInput */
/** @typedef {{ headSha: string, specs: string, runUrl: string, totalVideos: number, videos: UploadedVideo[] }} DemoCommentInput */
/** @typedef {{ description: string, labelIds: string[], projectId: string, stateId: string, teamId: string, title: string }} LinearIssueInput */
/** @typedef {LinearIssueInput & { id: string }} LinearCreateIssueInput */
/** @typedef {Partial<LinearIssueInput> & { stateId?: string }} LinearUpdateIssueInput */
/** @typedef {{ body: string, issueId: string }} LinearCommentInput */
/** @typedef {{ errors?: Array<{ message?: string }>, data: unknown }} LinearGraphqlPayload */
/** @typedef {{ success: boolean, issue?: LinearIssue }} LinearIssueMutation */
/** @typedef {{ success: boolean, comment?: LinearComment }} LinearCommentMutation */
/** @typedef {{ assetUrl: string, uploadUrl: string, headers: Array<{ key: string, value: string }> }} LinearUpload */
/** @typedef {{ success: boolean, uploadFile?: LinearUpload }} LinearUploadMutation */
/** @typedef {{ teamStates(teamId: string): Promise<LinearWorkflowState[]>, issue(issueId: string): Promise<LinearIssue | undefined>, createIssue(input: LinearCreateIssueInput): Promise<LinearIssue>, updateIssue(issueId: string, input: LinearUpdateIssueInput): Promise<LinearIssue>, createComment(input: LinearCommentInput): Promise<LinearComment>, uploadFile(filePath: string, filename?: string): Promise<UploadedVideo> }} UiDemoClient */
/** @typedef {{ kind: 'issue-absent' } | { kind: 'updated', issue: LinearIssue }} UiDemoIssueTransition */

const UiDemoIssueTransitionKind = Object.freeze({
  Updated: 'updated',
  IssueAbsent: 'issue-absent',
})

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
const VIDEO_CONTENT_TYPE = 'video/webm'

/** @param {string} repository @param {number} prNumber @returns {string} */
const issueMarker = (repository, prNumber) =>
  `<!-- nook-ui-demo-pr:${repository}#${prNumber} -->`

/** @param {string} headSha @returns {string} */
const headMarker = (headSha) => `<!-- nook-ui-demo-head:${headSha} -->`

/** @param {string} repository @param {number} prNumber @returns {string} */
function deterministicIssueId(repository, prNumber) {
  const bytes = crypto
    .createHash('sha256')
    .update(`nook-ui-demo:${repository}#${prNumber}`)
    .digest()
    .subarray(0, 16)

  const versionByte = bytes[6]
  const variantByte = bytes[8]
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error('deterministic issue ID digest is too short')
  }
  bytes[6] = (versionByte & 0x0f) | 0x40
  bytes[8] = (variantByte & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join(
    '-',
  )
}

/** @param {string} root @returns {Promise<string[]>} */
async function findWebmFiles(root) {
  /** @type {string[]} */
  const files = []

  /** @param {string} directory @returns {Promise<void>} */
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          await visit(absolutePath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.webm')) {
          files.push(absolutePath)
        }
      }),
    )
  }

  await visit(root)
  return files.sort()
}

/** @param {string} root @param {number} limit @returns {Promise<{ files: string[], total: number }>} */
async function selectLargestWebmFiles(root, limit) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('UI demo video limit must be a positive integer')
  }

  const files = await findWebmFiles(root)
  const measured = await Promise.all(
    files.map(async (file) => ({ file, size: (await fs.stat(file)).size })),
  )
  measured.sort((left, right) => right.size - left.size || left.file.localeCompare(right.file))

  return {
    files: measured.slice(0, limit).map(({ file }) => file),
    total: measured.length,
  }
}

class LinearApi {
  /** @param {string} apiKey @param {typeof fetch} [fetchImpl] */
  constructor(apiKey, fetchImpl = globalThis.fetch) {
    if (!apiKey) throw new Error('LINEAR_API_KEY is required')
    if (!fetchImpl) throw new Error('A fetch implementation is required')
    this.apiKey = apiKey
    this.fetch = fetchImpl
  }

  /** @param {string} query @param {Record<string, unknown>} [variables] @returns {Promise<unknown>} */
  async graphql(query, variables = {}) {
    const response = await this.fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
    /** @type {LinearGraphqlPayload} */
    const payload = await response.json()

    if (!response.ok || payload.errors?.length) {
      const details = payload.errors?.map(({ message }) => message).join('; ') || response.statusText
      throw new Error(`Linear GraphQL request failed: ${details}`)
    }

    return payload.data
  }

  /** @param {string} issueId @returns {Promise<LinearIssue | undefined>} */
  async issue(issueId) {
    const data = /** @type {{ issues: { nodes: LinearIssue[] } }} */ (await this.graphql(
      `query UiDemoIssue($id: ID!) {
        issues(first: 1, filter: { id: { eq: $id } }) {
          nodes {
            id
            identifier
            title
            url
            comments(last: 100) { nodes { id body } }
          }
        }
      }`,
      { id: issueId },
    ))
    return data.issues.nodes[0]
  }

  /** @param {string} teamId @returns {Promise<LinearWorkflowState[]>} */
  async teamStates(teamId) {
    const data = /** @type {{ team: { states: { nodes: LinearWorkflowState[] } } }} */ (await this.graphql(
      `query UiDemoTeamStates($id: String!) {
        team(id: $id) { states { nodes { id name type } } }
      }`,
      { id: teamId },
    ))
    return data.team.states.nodes
  }

  /** @param {LinearCreateIssueInput} input @returns {Promise<LinearIssue>} */
  async createIssue(input) {
    const data = /** @type {{ issueCreate: LinearIssueMutation }} */ (await this.graphql(
      `mutation CreateUiDemoIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url comments(last: 100) { nodes { id body } } }
        }
      }`,
      { input },
    ))
    const issue = data.issueCreate.issue
    if (!data.issueCreate.success || !issue) {
      throw new Error('Linear did not create the UI demo issue')
    }
    return issue
  }

  /** @param {string} issueId @param {LinearUpdateIssueInput} input @returns {Promise<LinearIssue>} */
  async updateIssue(issueId, input) {
    const data = /** @type {{ issueUpdate: LinearIssueMutation }} */ (await this.graphql(
      `mutation UpdateUiDemoIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier title url comments(last: 100) { nodes { id body } } }
        }
      }`,
      { id: issueId, input },
    ))
    const issue = data.issueUpdate.issue
    if (!data.issueUpdate.success || !issue) {
      throw new Error('Linear did not update the UI demo issue')
    }
    return issue
  }

  /** @param {LinearCommentInput} input @returns {Promise<LinearComment>} */
  async createComment(input) {
    const data = /** @type {{ commentCreate: LinearCommentMutation }} */ (await this.graphql(
      `mutation CreateUiDemoComment($input: CommentCreateInput!) {
        commentCreate(input: $input) { success comment { id body } }
      }`,
      { input },
    ))
    const comment = data.commentCreate.comment
    if (!data.commentCreate.success || !comment) {
      throw new Error('Linear did not create the UI demo comment')
    }
    return comment
  }

  /** @param {string} filePath @param {string} [filename] @returns {Promise<UploadedVideo>} */
  async uploadFile(filePath, filename = path.basename(filePath)) {
    const contents = await fs.readFile(filePath)
    const data = /** @type {{ fileUpload: LinearUploadMutation }} */ (await this.graphql(
      `mutation UploadUiDemo($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success
          uploadFile { assetUrl uploadUrl headers { key value } }
        }
      }`,
      { contentType: VIDEO_CONTENT_TYPE, filename, size: contents.byteLength },
    ))
    const upload = data.fileUpload.uploadFile
    if (!data.fileUpload.success || !upload) throw new Error(`Linear did not prepare ${filename}`)

    const headers = new Headers({
      'Cache-Control': 'public, max-age=31536000',
      'Content-Type': VIDEO_CONTENT_TYPE,
    })
    upload.headers.forEach(({ key, value }) => headers.set(key, value))
    const response = await this.fetch(upload.uploadUrl, {
      method: 'PUT',
      headers,
      body: contents,
    })
    if (!response.ok) throw new Error(`Linear upload failed for ${filename}: HTTP ${response.status}`)

    return { assetUrl: upload.assetUrl, filename }
  }
}

/** @param {IssueDescriptionInput} input @returns {string} */
function issueDescription({ repository, prNumber, prTitle, prUrl }) {
  return [
    issueMarker(repository, prNumber),
    `Automated Playwright UI demonstrations for [${repository} PR #${prNumber}](${prUrl}).`,
    '',
    `**Pull request:** ${prTitle}`,
    '',
    'Each successful PR head is recorded in a comment below. Playwright assertions are authoritative; videos are review aids for humans and AI.',
  ].join('\n')
}

/** @param {DemoCommentInput} input @returns {string} */
function demoComment({ headSha, specs, runUrl, totalVideos, videos }) {
  return [
    headMarker(headSha),
    `## Playwright demos for \`${headSha.slice(0, 12)}\``,
    '',
    `- GitHub Actions: [workflow run](${runUrl})`,
    `- Demo specs: \`${specs}\``,
    `- Linear selection: ${videos.length} largest of ${totalVideos} recorded videos`,
    '',
    ...videos.flatMap(({ assetUrl, filename }) => [`### ${filename}`, `![${filename}](${assetUrl})`, '']),
  ].join('\n')
}

/** @param {LinearWorkflowState[]} states @param {string} type @returns {LinearWorkflowState} */
function stateByType(states, type) {
  const state = states.find((candidate) => candidate.type === type)
  if (!state) throw new Error(`Linear team has no ${type} workflow state`)
  return state
}

/**
 * @param {{ apiKey?: string, config: UiDemoConfig, demoDir: string, pullRequest: PullRequestInfo, client?: UiDemoClient, maxVideos?: number }} input
 * @returns {Promise<LinearIssue>}
 */
async function syncUiDemoIssue({ apiKey, config, demoDir, pullRequest, client, maxVideos = 10 }) {
  /** @type {UiDemoClient} */
  let linear
  if (client) {
    linear = client
  } else {
    if (!apiKey) throw new Error('LINEAR_API_KEY is required')
    linear = new LinearApi(apiKey)
  }
  const issueId = deterministicIssueId(config.repository, pullRequest.number)
  const states = await linear.teamStates(config.teamId)
  const startedState = stateByType(states, 'started')
  const description = issueDescription({
    repository: config.repository,
    prNumber: pullRequest.number,
    prTitle: pullRequest.title,
    prUrl: pullRequest.url,
  })
  const title = `UI demos — PR #${pullRequest.number}: ${pullRequest.title}`
  const issueInput = {
    description,
    labelIds: [config.labelId],
    projectId: config.projectId,
    stateId: startedState.id,
    teamId: config.teamId,
    title: title.slice(0, 255),
  }

  let issue = await linear.issue(issueId)
  if (issue) {
    issue = await linear.updateIssue(issueId, issueInput)
  } else {
    issue = await linear.createIssue({ id: issueId, ...issueInput })
  }

  const existingComment = issue.comments.nodes.find((comment) =>
    comment.body?.startsWith(headMarker(pullRequest.headSha)),
  )
  if (existingComment) return issue

  const selection = await selectLargestWebmFiles(demoDir, maxVideos)
  if (selection.total === 0) throw new Error(`No WebM videos found in ${demoDir}`)
  const videos = await Promise.all(
    selection.files.map((file) => {
      const filename = path.relative(demoDir, file).split(path.sep).join('--')
      return linear.uploadFile(file, filename)
    }),
  )
  const body = demoComment({
    headSha: pullRequest.headSha,
    specs: pullRequest.specs,
    runUrl: pullRequest.runUrl,
    totalVideos: selection.total,
    videos,
  })
  await linear.createComment({ body, issueId })

  return issue
}

/**
 * @param {{ apiKey?: string, config: UiDemoConfig, merged: boolean, prNumber: number, client?: UiDemoClient }} input
 * @returns {Promise<UiDemoIssueTransition>}
 */
async function transitionUiDemoIssue({
  apiKey,
  config,
  merged,
  prNumber,
  client,
}) {
  /** @type {UiDemoClient} */
  let linear
  if (client) {
    linear = client
  } else {
    if (!apiKey) throw new Error('LINEAR_API_KEY is required')
    linear = new LinearApi(apiKey)
  }
  const issueId = deterministicIssueId(config.repository, prNumber)
  const issue = await linear.issue(issueId)
  if (!issue) return { kind: UiDemoIssueTransitionKind.IssueAbsent }

  const states = await linear.teamStates(config.teamId)
  const target = stateByType(states, merged ? 'completed' : 'canceled')
  return {
    kind: UiDemoIssueTransitionKind.Updated,
    issue: await linear.updateIssue(issueId, { stateId: target.id }),
  }
}

module.exports = {
  LinearApi,
  demoComment,
  deterministicIssueId,
  findWebmFiles,
  headMarker,
  issueDescription,
  issueMarker,
  selectLargestWebmFiles,
  stateByType,
  syncUiDemoIssue,
  transitionUiDemoIssue,
  UiDemoIssueTransitionKind,
}
