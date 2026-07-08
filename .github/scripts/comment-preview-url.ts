const token = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const prNumber = process.env.PR_NUMBER
const previewUrl = process.env.PREVIEW_URL

if (!token || !repository || !prNumber || !previewUrl) {
  throw new Error(
    'Missing GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, or PREVIEW_URL',
  )
}

const [owner, repo] = repository.split('/')
const issue_number = Number(prNumber)

const url = previewUrl
const body = `### Preview deployed\n\n${url}`

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
}

async function expectJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${text}`)
  }
  return JSON.parse(text) as T
}

async function expectOk(response: Response): Promise<void> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${text}`)
  }
}

const listComments = () =>
  fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`,
    { headers },
  ).then((response) =>
    expectJson<Array<{ id: number; body: string }>>(response),
  )

const updateComment = (comment_id: number) =>
  fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/comments/${comment_id}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    },
  ).then(expectOk)

const createComment = () =>
  fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
    },
  ).then(expectOk)

const comments = await listComments()
const existing = comments.find((c) => c.body.startsWith('### Preview deployed'))

if (existing) {
  await updateComment(existing.id)
} else {
  await createComment()
}
