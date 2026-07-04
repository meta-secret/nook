const GITHUB_VAULT_PATH = 'nook-projection.yaml'
const GITHUB_FETCH_TIMEOUT_MS = 30_000
const GITHUB_RATE_LIMIT_MAX_WAIT_MS = 5 * 60_000

type RepoContext = {
  headers: Record<string, string>
  repo: string
  login: string
}

const repoContextCache = new Map<string, RepoContext>()
const vaultEtagCache = new Map<string, string>()
const vaultContentCache = new Map<string, string>()

export function githubApiHeaders(pat: string) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'nook-e2e',
    'Cache-Control': 'no-cache',
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimitResponse(res: Response, body: string) {
  return (
    res.status === 403 &&
    (body.includes('rate limit') ||
      body.includes('API rate limit exceeded') ||
      res.headers.get('x-ratelimit-remaining') === '0')
  )
}

async function waitForRateLimitReset(res: Response) {
  const resetHeader = res.headers.get('x-ratelimit-reset')
  const resetAt = resetHeader ? Number(resetHeader) * 1000 : Date.now() + 60_000
  const waitMs = Math.min(
    GITHUB_RATE_LIMIT_MAX_WAIT_MS,
    Math.max(0, resetAt - Date.now()) + 1_000,
  )
  console.warn(
    `[e2e] GitHub rate limit hit — waiting ${Math.ceil(waitMs / 1000)}s`,
  )
  await sleep(waitMs)
}

export function githubFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    cache: 'no-store',
  })
}

/** Authenticated fetch with rate-limit backoff (one retry after waiting). */
export async function githubApiFetch(
  pat: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = { ...githubApiHeaders(pat), ...init?.headers }
  let res = await githubFetch(url, { ...init, headers })
  if (res.ok || res.status === 404 || res.status === 304) {
    return res
  }

  const body = await res.text().catch(() => '')
  if (isRateLimitResponse(res, body)) {
    await waitForRateLimitReset(res)
    res = await githubFetch(url, { ...init, headers })
    if (res.ok || res.status === 404 || res.status === 304) {
      return res
    }
    const retryBody = await res.text().catch(() => '')
    throw new Error(
      `GitHub API failed after rate-limit wait: ${res.status}${retryBody ? ` — ${retryBody}` : ''}`,
    )
  }

  throw new Error(`GitHub API failed: ${res.status}${body ? ` — ${body}` : ''}`)
}

export async function githubRepoContext(
  pat: string,
  repoName: string,
): Promise<RepoContext> {
  const cacheKey = `${pat}:${repoName}`
  const cached = repoContextCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const userRes = await githubApiFetch(pat, 'https://api.github.com/user')
  const { login } = (await userRes.json()) as { login: string }
  const context: RepoContext = {
    headers: githubApiHeaders(pat),
    repo: `${login}/${repoName}`,
    login,
  }
  repoContextCache.set(cacheKey, context)
  return context
}

export async function fetchGithubVaultYaml(
  pat: string,
  repoName: string,
): Promise<string | null> {
  const { headers, repo } = await githubRepoContext(pat, repoName)
  const url = `https://api.github.com/repos/${repo}/contents/${GITHUB_VAULT_PATH}`
  const etagKey = `${pat}:${repoName}`
  const etag = vaultEtagCache.get(etagKey)
  const res = await githubApiFetch(pat, url, {
    headers: etag ? { ...headers, 'If-None-Match': etag } : headers,
  })

  if (res.status === 304) {
    return vaultContentCache.get(etagKey) ?? null
  }
  if (res.status === 404) {
    vaultEtagCache.delete(etagKey)
    vaultContentCache.delete(etagKey)
    return null
  }

  const nextEtag = res.headers.get('etag')
  if (nextEtag) {
    vaultEtagCache.set(etagKey, nextEtag)
  }

  const data = (await res.json()) as { content: string }
  const yaml = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString(
    'utf-8',
  )
  vaultContentCache.set(etagKey, yaml)
  return yaml
}

export { GITHUB_VAULT_PATH }
