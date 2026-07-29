import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerE2eGithubRepo } from '../github-repos'

dotenv.config({
  path: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../.env.test.local',
  ),
})

export const githubPat = process.env.NOOK_GITHUB_PAT?.trim() ?? ''
/** Legacy default for docs; GitHub e2e suites use {@link createE2eGithubRepoName}. */
export const DEFAULT_GITHUB_REPO = 'nook'

type E2eGithubRepoCache =
  | { kind: 'uncached' }
  | { kind: 'cached'; repoName: string }

let e2eGithubRepoCache: E2eGithubRepoCache = { kind: 'uncached' }

/**
 * One GitHub repo per Playwright container/run. CI sets NOOK_GITHUB_E2E_REPO per
 * docker:e2e:run (e.g. nook-e2e-github-$RUN_ID); local runs get a random nook-* repo.
 */
export function createE2eGithubRepoName(): string {
  if (e2eGithubRepoCache.kind === 'cached') {
    return e2eGithubRepoCache.repoName
  }

  const override = process.env.NOOK_GITHUB_E2E_REPO?.trim()
  if (override) {
    registerE2eGithubRepo(override)
    e2eGithubRepoCache = { kind: 'cached', repoName: override }
    return override
  }

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const repoName = `nook-${suffix}`
  registerE2eGithubRepo(repoName)
  e2eGithubRepoCache = { kind: 'cached', repoName }
  return repoName
}

/** UI actions we control should complete in a couple of seconds. */
export const UI_TIMEOUT_MS = 5_000
/** Password unlock / enrollment runs scrypt in wasm — allow more time on CI. */
export const ENROLLMENT_UNLOCK_TIMEOUT_MS = 30_000

export function configuredVaultSyncIntervalMs(): number {
  const parsed = Number(process.env.VITE_VAULT_SYNC_INTERVAL_MS)
  if (Number.isFinite(parsed) && parsed >= 250) return parsed
  return 30_000
}

export function configuredGithubPollIntervalMs(): number {
  const parsed = Number(process.env.NOOK_GITHUB_POLL_MS)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 3_000
}

export function configuredGithubSyncTimeoutMs(): number {
  const parsed = Number(process.env.NOOK_GITHUB_SYNC_TIMEOUT_MS)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 15_000
}

export function configuredGithubConnectTimeoutMs(): number {
  const parsed = Number(process.env.NOOK_GITHUB_CONNECT_TIMEOUT_MS)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 30_000
}

/** Background sync visibility — allow several ticks plus GitHub poll latency. */
export const NOTIFICATION_TIMEOUT_MS = Math.max(
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  configuredVaultSyncIntervalMs() * 6,
)

/** GitHub YAML polls are slow by design — prefer fewer API calls over fast failure. */
export const GITHUB_SYNC_TIMEOUT_MS = configuredGithubSyncTimeoutMs()
/** First connect may create the repo on GitHub. */
export const GITHUB_CONNECT_TIMEOUT_MS = configuredGithubConnectTimeoutMs()
export const GITHUB_SYNC_INTERVAL_MS = configuredGithubPollIntervalMs()

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
