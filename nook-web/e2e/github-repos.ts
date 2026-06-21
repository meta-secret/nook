import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '.e2e-github-repos.json',
)

const githubApiHeaders = (pat: string) => ({
  Authorization: `Bearer ${pat}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'nook-e2e',
})

async function githubRepoFullName(pat: string, repoName: string) {
  const headers = githubApiHeaders(pat)
  const userRes = await fetch('https://api.github.com/user', {
    headers,
    cache: 'no-store',
  })
  if (!userRes.ok) {
    throw new Error(`GitHub user fetch failed: ${userRes.status}`)
  }
  const { login } = (await userRes.json()) as { login: string }
  return { headers, repo: `${login}/${repoName}` }
}

export function readRegisteredE2eGithubRepos(): string[] {
  try {
    if (!fs.existsSync(REGISTRY_PATH)) {
      return []
    }
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

function writeRegisteredRepos(repos: string[]) {
  const unique = [...new Set(repos)]
  if (unique.length === 0) {
    if (fs.existsSync(REGISTRY_PATH)) {
      fs.unlinkSync(REGISTRY_PATH)
    }
    return
  }
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(unique, null, 2)}\n`)
}

export function registerE2eGithubRepo(repoName: string) {
  const repos = readRegisteredE2eGithubRepos()
  if (!repos.includes(repoName)) {
    writeRegisteredRepos([...repos, repoName])
  }
}

export function unregisterE2eGithubRepo(repoName: string) {
  writeRegisteredRepos(
    readRegisteredE2eGithubRepos().filter((name) => name !== repoName),
  )
}

export function isRegisteredE2eGithubRepo(repoName: string) {
  return readRegisteredE2eGithubRepos().includes(repoName)
}

/** DELETE /repos/{owner}/{repo} — requires delete_repo scope on the PAT. */
export async function deleteGithubRepo(pat: string, repoName: string) {
  if (!pat) {
    return
  }
  const { headers, repo } = await githubRepoFullName(pat, repoName)
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    method: 'DELETE',
    headers,
    cache: 'no-store',
  })
  if (res.status === 404) {
    return
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `GitHub repo delete failed for ${repo}: ${res.status}${body ? ` — ${body}` : ''}`,
    )
  }
}

export async function cleanupE2eGithubRepo(pat: string, repoName: string) {
  if (!pat || !isRegisteredE2eGithubRepo(repoName)) {
    return
  }
  try {
    await deleteGithubRepo(pat, repoName)
    unregisterE2eGithubRepo(repoName)
    console.log(`[e2e] deleted GitHub repo: ${repoName}`)
  } catch (error) {
    console.warn(
      `[e2e] failed to delete GitHub repo ${repoName}:`,
      error instanceof Error ? error.message : error,
    )
  }
}

export async function cleanupAllRegisteredE2eGithubRepos(pat: string) {
  if (!pat) {
    return
  }
  const repos = readRegisteredE2eGithubRepos()
  if (repos.length === 0) {
    return
  }
  console.log(`[e2e] cleaning up ${repos.length} GitHub repo(s)...`)
  for (const repoName of repos) {
    await cleanupE2eGithubRepo(pat, repoName)
  }
}
