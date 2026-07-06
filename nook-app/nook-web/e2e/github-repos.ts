import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { githubApiFetch, githubRepoContext } from './github-api'

const REGISTRY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '.e2e-github-repos.json',
)

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
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(unique, undefined, 2)}\n`)
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
  const { repo } = await githubRepoContext(pat, repoName)
  const res = await githubApiFetch(
    pat,
    `https://api.github.com/repos/${repo}`,
    {
      method: 'DELETE',
    },
  )
  if (res.status === 404) {
    return
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
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
}
