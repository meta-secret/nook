import { expect, type Page } from '@playwright/test'
import {
  GITHUB_VAULT_PATH,
  fetchGithubVaultYaml,
  GithubVaultYamlFetchKind,
  githubApiFetch,
  githubApiHeaders,
  githubFetch,
  githubRepoContext,
} from '../github-api'
import {
  assertGenesisVaultYaml,
  joinCountFromYaml,
  parseVaultYamlSnapshot,
  waitForVaultEventLogSnapshot,
  type VaultYamlSnapshot,
} from '../vault-yaml'
import { keepVaultIdleLockDisabled } from './device-enrollment'
import {
  DEFAULT_GITHUB_REPO,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  GITHUB_SYNC_INTERVAL_MS,
  GITHUB_SYNC_TIMEOUT_MS,
  sleep,
} from './environment'
import { createLocalE2eGithubVaultStub } from './local-sync'
import { assertVaultReady } from './settings-auth'
import { waitForVaultOperationsIdle } from './vault-runtime'

export type GithubE2eTarget = {
  pat: string
  repoName: string
  /** In-memory GitHub REST stub — avoids api.github.com (PR/main CI). */
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>
}

export { fetchGithubVaultYaml }

export /** GitHub sync can briefly fail while a repo or vault file is still being created. */
function isTransientVaultSyncError(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  return (
    /Cannot write to .+\((404|409|502|503)\)/i.test(normalized) ||
    /GitHub error:.*\((404|409|502|503)\)/i.test(normalized) ||
    /Ensure your PAT has repo scope/i.test(normalized) ||
    /failed to fetch/i.test(normalized) ||
    /network error/i.test(normalized) ||
    /connection (?:error|reset|refused|timed out)/i.test(normalized) ||
    /rate limit/i.test(normalized) ||
    /recursive use of an object detected/i.test(normalized)
  )
}

export function summarizeVaultError(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (/Cannot write to .+\(404\)/i.test(normalized)) {
    return 'GitHub vault write 404 (transient — repo or file not ready yet)'
  }
  if (/Cannot write to .+\((\d{3})\)/i.test(normalized)) {
    const code = normalized.match(/\((\d{3})\)/)?.[1]
    return code
      ? `GitHub vault write HTTP ${code} (transient sync error)`
      : 'GitHub vault write error (transient sync error)'
  }
  if (/rate limit/i.test(normalized)) {
    return 'GitHub rate limit (transient)'
  }
  if (/failed to fetch|network error|connection/i.test(normalized)) {
    return 'Network error talking to GitHub (transient)'
  }
  if (/recursive use of an object detected/i.test(normalized)) {
    return 'WASM busy (transient — retrying)'
  }
  return normalized.length > 160 ? `${normalized.slice(0, 157)}…` : normalized
}

/** Between suites: wipe vault YAML only. Repo deletion happens once in global teardown. */
export async function finishE2eGithubSuite(pat: string, repoName: string) {
  await resetGithubVault(pat, repoName)
}

export async function deleteGithubFileIfExists(
  pat: string,
  headers: ReturnType<typeof githubApiHeaders>,
  repo: string,
  vaultPath: string,
) {
  const contentsUrl = `https://api.github.com/repos/${repo}/contents/${vaultPath}`

  for (let attempt = 0; attempt < 5; attempt++) {
    const fileRes = await githubApiFetch(pat, contentsUrl, { headers })
    if (fileRes.status === 404) {
      return
    }
    if (!fileRes.ok) {
      throw new Error(
        `GitHub vault fetch failed for ${vaultPath}: ${fileRes.status}`,
      )
    }

    const file = (await fileRes.json()) as { sha: string }
    const deleteRes = await githubFetch(contentsUrl, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Reset nook e2e vault',
        sha: file.sha,
      }),
    })

    if (deleteRes.ok || deleteRes.status === 404) {
      await sleep(2_000)
      continue
    }

    if (deleteRes.status === 409 || deleteRes.status === 422) {
      await sleep(2_000)
      continue
    }

    throw new Error(
      `GitHub vault delete failed for ${vaultPath}: ${deleteRes.status}`,
    )
  }

  const verify = await githubApiFetch(pat, contentsUrl, { headers })
  if (verify.status === 404) {
    return
  }
  throw new Error(`GitHub vault ${vaultPath} still present after reset`)
}

/** Wipe remote vault file so a fresh local encryption key can connect. */
export async function resetGithubVault(
  pat: string,
  repoName = DEFAULT_GITHUB_REPO,
) {
  const { headers, repo } = await githubRepoContext(pat, repoName)
  await deleteGithubFileIfExists(pat, headers, repo, GITHUB_VAULT_PATH)
}

export async function waitForVaultYaml(
  pat: string,
  repoName: string,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number; page?: Page },
): Promise<VaultYamlSnapshot> {
  const [timeoutMs = GITHUB_SYNC_TIMEOUT_MS] = [options?.timeoutMs]
  const [intervalMs = GITHUB_SYNC_INTERVAL_MS] = [options?.intervalMs]
  const deadline = Date.now() + timeoutMs
  let lastError = 'vault file missing'

  while (Date.now() < deadline) {
    if (options?.page) {
      await assertNoVaultErrors(options.page, { allowTransient: true })
    }
    const result = await fetchGithubVaultYaml(pat, repoName)
    if (result.kind === GithubVaultYamlFetchKind.Available) {
      const snapshot = parseVaultYamlSnapshot(result.yaml)
      if (predicate(snapshot)) {
        return snapshot
      }
      lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, joins=${joinCountFromYaml(result.yaml)})`
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for vault YAML: ${lastError}`)
}

export async function assertNoVaultErrors(
  page: Page,
  options?: { allowTransient?: boolean },
) {
  const vaultError = page.getByTestId('vault-error')
  if (!(await vaultError.isVisible())) {
    return
  }

  const text = ((v) => (v ? v : ''))(await vaultError.textContent()).trim()
  if (options?.allowTransient && isTransientVaultSyncError(text)) {
    console.warn(
      `[e2e] transient vault sync error (expected): ${summarizeVaultError(text)}`,
    )
    return
  }

  throw new Error(`Vault error: ${summarizeVaultError(text)}`)
}

export const KNOWN_VAULT_FAILURE_PATTERNS = [
  /vault crypto not initialized/i,
  /failed to save secret/i,
  /encryption failed/i,
] as const

/** Fail when the vault error banner shows a known save/sync failure. */
export async function assertNoVaultError(page: Page) {
  const vaultError = page.getByTestId('vault-error')
  if (!(await vaultError.isVisible())) {
    return
  }
  const text = ((v) => (v ? v : ''))(await vaultError.textContent()).trim()
  if (
    KNOWN_VAULT_FAILURE_PATTERNS.some((pattern) => pattern.test(text)) ||
    text.length > 0
  ) {
    throw new Error(`Vault error: ${summarizeVaultError(text)}`)
  }
}

/** Click the vault sync refresh control when available. */
export async function triggerVaultSyncRefresh(page: Page) {
  await keepVaultIdleLockDisabled(page)
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  const refresh = page.getByTestId('vault-sync-refresh-btn')
  await expect(refresh).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect
    .poll(
      async () => {
        if (!(await refresh.isVisible())) return false
        return refresh.isEnabled()
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await refresh.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const vault = (
            window as Window & {
              __nookVault?: { isSyncing?: boolean }
            }
          ).__nookVault
          return vault ? Boolean(vault.isSyncing) : false
        }),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await waitForVaultOperationsIdle(page)
}

/** Wait until the e2e sync remote has the expected vault state. */
export async function waitForSyncRemoteVaultState(
  remote: { getEventFileContents: () => string[] },
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number; page?: Page },
): Promise<VaultYamlSnapshot> {
  return waitForVaultEventLogSnapshot(remote.getEventFileContents, predicate, {
    timeoutMs: ((...[v = ENROLLMENT_UNLOCK_TIMEOUT_MS]) => v)(
      options?.timeoutMs,
    ),
    intervalMs: ((...[v = 100]) => v)(options?.intervalMs),
  })
}

export async function flushRemoteEventsToSyncProviders(page: Page) {
  await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: {
          runFanOutSyncAfterLocalSave?: () => Promise<void>
        }
      }
    ).__nookVault
    await vault?.runFanOutSyncAfterLocalSave?.()
  })
  await waitForVaultOperationsIdle(page)
}

export async function assertGenesisVaultOnSyncRemote(remote: {
  getEventFileContents: () => string[]
}) {
  const snapshot = await waitForSyncRemoteVaultState(
    remote,
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
  )
  assertGenesisVaultYaml(snapshot)
  return snapshot
}

/** Wait until sync target has the expected vault state (local e2e remote or live GitHub). */
export async function waitForGithubVaultState(
  target: GithubE2eTarget,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number; page?: Page },
): Promise<VaultYamlSnapshot> {
  if (target.stub) {
    const { waitForStubVaultState } = await import('../sync-stub')
    return waitForStubVaultState(
      { pat: target.pat, repoName: target.repoName, stub: target.stub },
      predicate,
      options,
    )
  }
  return waitForVaultYaml(target.pat, target.repoName, predicate, options)
}
