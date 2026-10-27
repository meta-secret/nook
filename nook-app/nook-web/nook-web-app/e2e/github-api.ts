const GITHUB_VAULT_PATH = 'nook-events'
/** The root every provider keeps its identities and vaults under. */
export const GITHUB_PROVIDER_ROOT = 'meta-secret-nook'
const GITHUB_EVENT_FILE_NAME = /^[A-Za-z0-9_-]{43}\.yaml$/i
const GITHUB_FETCH_TIMEOUT_MS = 30_000
const GITHUB_RATE_LIMIT_MAX_WAIT_MS = 5 * 60_000

type RepoContext = {
  headers: ReturnType<typeof githubApiHeaders>
  repo: string
  login: string
}

const repoContextCache = new Map<string, RepoContext>()
const vaultEtagCache = new Map<string, string>()
const vaultContentCache = new Map<string, string>()

import { readStringProperty, requireRecord } from './helpers/guards'

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
    signal: ((...[v = AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS)]) => v)(
      init?.signal,
    ),
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
  const login = readStringProperty(
    requireRecord(await userRes.json(), 'GitHub user response'),
    'login',
    'GitHub user response',
  )
  const context: RepoContext = {
    headers: githubApiHeaders(pat),
    repo: `${login}/${repoName}`,
    login,
  }
  repoContextCache.set(cacheKey, context)
  return context
}

export enum GithubVaultYamlFetchKind {
  Missing = 'missing',
  Available = 'available',
}

export type GithubVaultYamlFetch =
  | { kind: GithubVaultYamlFetchKind.Missing }
  | { kind: GithubVaultYamlFetchKind.Available; yaml: string }

export enum GithubEventLogFetchKind {
  Missing = 'missing',
  Available = 'available',
}

export type GithubEventLogFetch =
  | { kind: GithubEventLogFetchKind.Missing }
  | {
      kind: GithubEventLogFetchKind.Available
      eventYamls: string[]
    }

enum GithubDirectoryEntryType {
  File = 'file',
  Dir = 'dir',
}

type GithubDirectoryEntry = {
  readonly name: string
  readonly path: string
  readonly type: string
}

enum GithubDirectoryListingKind {
  Missing = 'missing',
  Listed = 'listed',
}

type GithubDirectoryListing =
  | { kind: GithubDirectoryListingKind.Missing }
  | {
      kind: GithubDirectoryListingKind.Listed
      entries: GithubDirectoryEntry[]
    }

type GithubDirectoryRequest = {
  readonly pat: string
  readonly repo: string
  readonly headers: RepoContext['headers']
  readonly path: string
}

async function listGithubDirectory(
  request: GithubDirectoryRequest,
): Promise<GithubDirectoryListing> {
  const { pat, repo, headers, path } = request
  const url = `https://api.github.com/repos/${repo}/contents/${path}`
  const res = await githubApiFetch(pat, url, { headers })
  if (res.status === 404) {
    return { kind: GithubDirectoryListingKind.Missing }
  }
  const value: unknown = await res.json()
  if (!Array.isArray(value)) {
    throw new Error(`GitHub directory ${path} was not an array.`)
  }
  const entries = value.map((item) => {
    const entry = requireRecord(item, 'GitHub directory entry')
    return {
      name: readStringProperty(entry, 'name', 'GitHub directory entry'),
      path: readStringProperty(entry, 'path', 'GitHub directory entry'),
      type: readStringProperty(entry, 'type', 'GitHub directory entry'),
    }
  })
  return { kind: GithubDirectoryListingKind.Listed, entries }
}

/** The event files of every vault in the repository: each identity's folder
 * under the provider root holds its vaults' `<store id>/events` folders. */
async function vaultEventPaths(
  context: Omit<GithubDirectoryRequest, 'path'>,
): Promise<string[]> {
  const rootRequest: GithubDirectoryRequest = {
    ...context,
    path: GITHUB_PROVIDER_ROOT,
  }
  const root = await listGithubDirectory(rootRequest)
  if (root.kind === GithubDirectoryListingKind.Missing) return []
  const paths: string[] = []
  for (const identity of root.entries) {
    if (
      identity.type !== GithubDirectoryEntryType.Dir ||
      !identity.name.startsWith('idn_')
    )
      continue
    const identityRequest: GithubDirectoryRequest = {
      ...context,
      path: identity.path,
    }
    const folders = await listGithubDirectory(identityRequest)
    if (folders.kind === GithubDirectoryListingKind.Missing) continue
    for (const vault of folders.entries) {
      if (
        vault.type !== GithubDirectoryEntryType.Dir ||
        !vault.name.startsWith('store_')
      )
        continue
      const eventsRequest: GithubDirectoryRequest = {
        ...context,
        path: `${vault.path}/events`,
      }
      const events = await listGithubDirectory(eventsRequest)
      if (events.kind === GithubDirectoryListingKind.Missing) continue
      paths.push(
        ...events.entries
          .filter(
            (event) =>
              event.type === GithubDirectoryEntryType.File &&
              GITHUB_EVENT_FILE_NAME.test(event.name),
          )
          .map((event) => event.path),
      )
    }
  }
  return paths.sort()
}

export async function fetchGithubEventLog(
  pat: string,
  repoName: string,
): Promise<GithubEventLogFetch> {
  const { headers, repo } = await githubRepoContext(pat, repoName)
  const context: Omit<GithubDirectoryRequest, 'path'> = { pat, repo, headers }
  const paths = await vaultEventPaths(context)
  const eventYamls: string[] = []
  for (const path of paths) {
    const fileUrl = `https://api.github.com/repos/${repo}/contents/${path}`
    const fileRes = await githubApiFetch(pat, fileUrl, { headers })
    if (fileRes.status === 404) continue

    const file = requireRecord(await fileRes.json(), 'GitHub event file')
    const content = readStringProperty(file, 'content', 'GitHub event file')
    eventYamls.push(
      Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf-8'),
    )
  }

  return eventYamls.length > 0
    ? { kind: GithubEventLogFetchKind.Available, eventYamls }
    : { kind: GithubEventLogFetchKind.Missing }
}

export async function fetchGithubVaultYaml(
  pat: string,
  repoName: string,
): Promise<GithubVaultYamlFetch> {
  const { headers, repo } = await githubRepoContext(pat, repoName)
  const url = `https://api.github.com/repos/${repo}/contents/${GITHUB_VAULT_PATH}`
  const etagKey = `${pat}:${repoName}`
  const etag = vaultEtagCache.get(etagKey)
  const res = await githubApiFetch(pat, url, {
    headers: etag ? { ...headers, 'If-None-Match': etag } : headers,
  })

  if (res.status === 304) {
    const cached = vaultContentCache.get(etagKey)
    return cached
      ? { kind: GithubVaultYamlFetchKind.Available, yaml: cached }
      : { kind: GithubVaultYamlFetchKind.Missing }
  }
  if (res.status === 404) {
    vaultEtagCache.delete(etagKey)
    vaultContentCache.delete(etagKey)
    return { kind: GithubVaultYamlFetchKind.Missing }
  }

  const nextEtag = res.headers.get('etag')
  if (nextEtag) {
    vaultEtagCache.set(etagKey, nextEtag)
  }

  const data = requireRecord(await res.json(), 'GitHub vault response')
  const content = readStringProperty(data, 'content', 'GitHub vault response')
  const yaml = Buffer.from(content.replace(/\n/g, ''), 'base64').toString(
    'utf-8',
  )
  vaultContentCache.set(etagKey, yaml)
  return { kind: GithubVaultYamlFetchKind.Available, yaml }
}

export { GITHUB_VAULT_PATH }
