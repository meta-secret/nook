const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
const VIDEO_CONTENT_TYPE = 'video/webm'

const issueMarker = (repository, prNumber) =>
  `<!-- nook-ui-demo-pr:${repository}#${prNumber} -->`

const headMarker = (headSha) => `<!-- nook-ui-demo-head:${headSha} -->`

function deterministicIssueId(repository, prNumber) {
  const bytes = crypto
    .createHash('sha256')
    .update(`nook-ui-demo:${repository}#${prNumber}`)
    .digest()
    .subarray(0, 16)

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join(
    '-',
  )
}

async function findWebmFiles(root) {
  const files = []

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
  constructor(apiKey, fetchImpl = globalThis.fetch) {
    if (!apiKey) throw new Error('LINEAR_API_KEY is required')
    if (!fetchImpl) throw new Error('A fetch implementation is required')
    this.apiKey = apiKey
    this.fetch = fetchImpl
  }

  async graphql(query, variables = {}) {
    const response = await this.fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
    const payload = await response.json()

    if (!response.ok || payload.errors?.length) {
      const details = payload.errors?.map(({ message }) => message).join('; ') || response.statusText
      throw new Error(`Linear GraphQL request failed: ${details}`)
    }

    return payload.data
  }

  async issue(issueId) {
    const data = await this.graphql(
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
    )
    return data.issues.nodes[0]
  }

  async teamStates(teamId) {
    const data = await this.graphql(
      `query UiDemoTeamStates($id: String!) {
        team(id: $id) { states { nodes { id name type } } }
      }`,
      { id: teamId },
    )
    return data.team.states.nodes
  }

  async createIssue(input) {
    const data = await this.graphql(
      `mutation CreateUiDemoIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url comments(last: 100) { nodes { id body } } }
        }
      }`,
      { input },
    )
    if (!data.issueCreate.success || !data.issueCreate.issue) {
      throw new Error('Linear did not create the UI demo issue')
    }
    return data.issueCreate.issue
  }

  async updateIssue(issueId, input) {
    const data = await this.graphql(
      `mutation UpdateUiDemoIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier title url comments(last: 100) { nodes { id body } } }
        }
      }`,
      { id: issueId, input },
    )
    if (!data.issueUpdate.success || !data.issueUpdate.issue) {
      throw new Error('Linear did not update the UI demo issue')
    }
    return data.issueUpdate.issue
  }

  async createComment(input) {
    const data = await this.graphql(
      `mutation CreateUiDemoComment($input: CommentCreateInput!) {
        commentCreate(input: $input) { success comment { id body } }
      }`,
      { input },
    )
    if (!data.commentCreate.success) throw new Error('Linear did not create the UI demo comment')
    return data.commentCreate.comment
  }

  async uploadFile(filePath, filename = path.basename(filePath)) {
    const contents = await fs.readFile(filePath)
    const data = await this.graphql(
      `mutation UploadUiDemo($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success
          uploadFile { assetUrl uploadUrl headers { key value } }
        }
      }`,
      { contentType: VIDEO_CONTENT_TYPE, filename, size: contents.byteLength },
    )
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

function stateByType(states, type) {
  const state = states.find((candidate) => candidate.type === type)
  if (!state) throw new Error(`Linear team has no ${type} workflow state`)
  return state
}

async function syncUiDemoIssue({ apiKey, config, demoDir, pullRequest, client, maxVideos = 10 }) {
  const linear = client || new LinearApi(apiKey)
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

async function transitionUiDemoIssue({ apiKey, config, merged, prNumber, client }) {
  const linear = client || new LinearApi(apiKey)
  const issueId = deterministicIssueId(config.repository, prNumber)
  const issue = await linear.issue(issueId)
  if (!issue) return undefined

  const states = await linear.teamStates(config.teamId)
  const target = stateByType(states, merged ? 'completed' : 'canceled')
  return linear.updateIssue(issueId, { stateId: target.id })
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
}
