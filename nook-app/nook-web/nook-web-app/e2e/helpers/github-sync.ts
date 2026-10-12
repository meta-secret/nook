import { type Page } from '@playwright/test'
import {
  GithubEventLogFetchKind,
  GithubVaultYamlFetchKind,
  fetchGithubEventLog,
  fetchGithubVaultYaml,
} from '../github-api'
import {
  parseVaultEventLogSnapshot,
  parseVaultYamlSnapshot,
  type VaultYamlSnapshot,
} from '../vault-yaml'
import {
  GITHUB_SYNC_INTERVAL_MS,
  GITHUB_SYNC_TIMEOUT_MS,
  sleep,
} from './environment'

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
    const result = await fetchGithubEventLog(pat, repoName)
    if (result.kind === GithubEventLogFetchKind.Available) {
      const snapshot = parseVaultEventLogSnapshot(result.eventYamls)
      if (predicate(snapshot)) {
        return snapshot
      }
      lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, joins=${snapshot.joinEntries.length})`
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for vault YAML: ${lastError}`)
}

/** Wait until the mutable GitHub projection reflects the expected vault state. */
export async function waitForGithubVaultProjectionState(
  pat: string,
  repoName: string,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const [timeoutMs = GITHUB_SYNC_TIMEOUT_MS] = [options?.timeoutMs]
  const [intervalMs = GITHUB_SYNC_INTERVAL_MS] = [options?.intervalMs]
  const deadline = Date.now() + timeoutMs
  let lastError = 'vault file missing'

  while (Date.now() < deadline) {
    const result = await fetchGithubVaultYaml(pat, repoName)
    if (result.kind === GithubVaultYamlFetchKind.Available) {
      const snapshot = parseVaultYamlSnapshot(result.yaml)
      if (predicate(snapshot)) {
        return snapshot
      }
      lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, joins=${snapshot.joinEntries.length})`
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for GitHub vault projection: ${lastError}`)
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
