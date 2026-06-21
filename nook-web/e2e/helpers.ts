import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertEnrolledVaultYaml,
  assertGenesisVaultYaml,
  assertJoinPendingYaml,
  joinCountFromYaml,
  parseVaultYamlSnapshot,
  type VaultYamlSnapshot,
} from './vault-yaml'
import { registerE2eGithubRepo } from './github-repos'

export {
  cleanupAllRegisteredE2eGithubRepos,
  cleanupE2eGithubRepo,
} from './github-repos'

dotenv.config({
  path: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../.env.test.local',
  ),
})

export const githubPat = process.env.NOOK_GITHUB_PAT?.trim() ?? ''
/** Legacy default for docs; GitHub e2e suites use {@link createE2eGithubRepoName}. */
export const DEFAULT_GITHUB_REPO = 'nook'

/** Unique repo per run so parallel PRs do not share `nook-vault.yaml`. */
export function createE2eGithubRepoName(): string {
  const override = process.env.NOOK_GITHUB_E2E_REPO?.trim()
  if (override) {
    return override
  }
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const repoName = `nook-${suffix}`
  registerE2eGithubRepo(repoName)
  return repoName
}

const GITHUB_VAULT_PATH = 'nook-vault.yaml'

/** UI actions we control should complete quickly; long waits hide bugs. */
export const UI_TIMEOUT_MS = 5_000
/** GitHub API round-trip budget when we just wrote the vault ourselves. */
const GITHUB_SYNC_TIMEOUT_MS = 10_000
const GITHUB_SYNC_INTERVAL_MS = 500

const githubApiHeaders = (pat: string) => ({
  Authorization: `Bearer ${pat}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'nook-e2e',
  'Cache-Control': 'no-cache',
})

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function githubRepoContext(pat: string, repoName: string) {
  const headers = githubApiHeaders(pat)
  const userRes = await fetch('https://api.github.com/user', {
    headers,
    cache: 'no-store',
  })
  if (!userRes.ok) {
    throw new Error(`GitHub user fetch failed: ${userRes.status}`)
  }
  const { login } = (await userRes.json()) as { login: string }
  return { headers, repo: `${login}/${repoName}`, login }
}

async function deleteGithubFileIfExists(
  headers: ReturnType<typeof githubApiHeaders>,
  repo: string,
  vaultPath: string,
) {
  const contentsUrl = `https://api.github.com/repos/${repo}/contents/${vaultPath}`

  for (let attempt = 0; attempt < 15; attempt++) {
    const fileRes = await fetch(contentsUrl, { headers, cache: 'no-store' })
    if (fileRes.status === 404) {
      return
    }
    if (!fileRes.ok) {
      throw new Error(
        `GitHub vault fetch failed for ${vaultPath}: ${fileRes.status}`,
      )
    }

    const file = (await fileRes.json()) as { sha: string }
    const deleteRes = await fetch(contentsUrl, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Reset nook e2e vault',
        sha: file.sha,
      }),
      cache: 'no-store',
    })

    if (deleteRes.ok || deleteRes.status === 404) {
      await sleep(400)
      continue
    }

    if (deleteRes.status === 409 || deleteRes.status === 422) {
      await sleep(400)
      continue
    }

    throw new Error(
      `GitHub vault delete failed for ${vaultPath}: ${deleteRes.status}`,
    )
  }

  const verify = await fetch(contentsUrl, { headers, cache: 'no-store' })
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
  await deleteGithubFileIfExists(headers, repo, GITHUB_VAULT_PATH)
}

export async function fetchGithubVaultYaml(
  pat: string,
  repoName: string,
): Promise<string | null> {
  const { headers, repo } = await githubRepoContext(pat, repoName)
  const url = `https://api.github.com/repos/${repo}/contents/${GITHUB_VAULT_PATH}`
  const res = await fetch(url, { headers, cache: 'no-store' })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    throw new Error(`GitHub vault fetch failed: ${res.status}`)
  }
  const data = (await res.json()) as { content: string }
  return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString(
    'utf-8',
  )
}

export async function waitForVaultYaml(
  pat: string,
  repoName: string,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const timeoutMs = options?.timeoutMs ?? GITHUB_SYNC_TIMEOUT_MS
  const intervalMs = options?.intervalMs ?? GITHUB_SYNC_INTERVAL_MS
  const deadline = Date.now() + timeoutMs
  let lastError = 'vault file missing'

  while (Date.now() < deadline) {
    const yaml = await fetchGithubVaultYaml(pat, repoName)
    if (yaml) {
      const snapshot = parseVaultYamlSnapshot(yaml)
      if (predicate(snapshot)) {
        return snapshot
      }
      lastError = `predicate not satisfied (joins=${joinCountFromYaml(yaml)})`
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for vault YAML: ${lastError}`)
}

export async function clearBrowserVault(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        localStorage.clear()
        let pending = 2
        const done = () => {
          pending -= 1
          if (pending === 0) resolve()
        }
        const onError = (err: DOMException | null) =>
          reject(err ?? new Error('IndexedDB delete failed'))

        const vaultDb = indexedDB.deleteDatabase('nook_db')
        vaultDb.onsuccess = done
        vaultDb.onerror = () => onError(vaultDb.error)
        vaultDb.onblocked = done

        const authDb = indexedDB.deleteDatabase('nook_auth')
        authDb.onsuccess = done
        authDb.onerror = () => onError(authDb.error)
        authDb.onblocked = done
      }),
  )
}

export async function createIsolatedContext(
  browser: Browser,
): Promise<BrowserContext> {
  return browser.newContext()
}

export function uniqueSecretKey(prefix: string) {
  return `${prefix}-${Date.now()}`
}

export async function waitForEngine(page: Page) {
  const button = page
    .getByTestId('unlock-vault-btn')
    .or(page.getByTestId('sign-in-btn'))
  await expect(button.first()).toBeVisible()
  await expect(button.first()).not.toContainText('Loading engine', {
    timeout: 20_000,
  })
  return button.first()
}

async function assertGithubConnected(page: Page) {
  const error = page.getByTestId('connect-error')
  if (await error.isVisible()) {
    throw new Error(`GitHub connect failed: ${await error.textContent()}`)
  }
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: 90_000,
  })
}

async function setupGithubProvider(page: Page, pat: string, repoName: string) {
  await page.getByTestId('provider-option-github').click()
  await page.getByTestId('github-repo-input').fill(repoName)
  await page.getByTestId('github-pat-input').fill(pat)
}

export async function waitForVaultUnlocked(page: Page) {
  await expect(page.getByTestId('vault-panel')).toBeVisible({ timeout: 90_000 })
}

export async function connectLocalVault(page: Page) {
  await page.goto('/')
  await expect(
    page.getByTestId('vault-panel').or(page.getByTestId('login-gate')),
  ).toBeVisible({ timeout: 20_000 })

  if (await page.getByTestId('vault-panel').isVisible()) {
    return
  }

  const unlockButton = page.getByTestId('unlock-vault-btn')
  if (await unlockButton.isVisible()) {
    const autoUnlocked = await page
      .getByTestId('vault-panel')
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => true)
      .catch(() => false)
    if (autoUnlocked) {
      return
    }
    const button = await waitForEngine(page)
    await button.click()
    await expect(
      page.getByTestId('connect-success').or(page.getByTestId('app-success')),
    ).toContainText('Local vault loaded', { timeout: 20_000 })
  } else {
    await page.getByTestId('provider-option-local').click()
    const connectButton = await waitForEngine(page)
    await connectButton.click()
    await expect(
      page.getByTestId('connect-success').or(page.getByTestId('app-success')),
    ).toContainText('Local vault loaded', { timeout: 20_000 })
  }
  await expect(page.getByTestId('vault-panel')).toBeVisible()
}

export async function connectGithubVault(
  page: Page,
  pat: string,
  repoName = DEFAULT_GITHUB_REPO,
) {
  await page.goto('/')
  await setupGithubProvider(page, pat, repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await expect(
    page.getByTestId('connect-success').or(page.getByTestId('app-success')),
  ).toContainText('Connected to GitHub', { timeout: 90_000 })
  await assertGithubConnected(page)
}

/** Genesis device: fresh browser + GitHub repo → connected vault. */
export async function connectGithubGenesisDevice(
  page: Page,
  pat: string,
  repoName: string,
) {
  await page.goto('/')
  await clearBrowserVault(page)
  await page.reload()
  await connectGithubVault(page, pat, repoName)
  await waitForVaultYaml(
    pat,
    repoName,
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
  )
}

/** Second device: same repo → join enrollment dialog. */
export async function connectGithubJoinerDevice(
  page: Page,
  pat: string,
  repoName: string,
) {
  await page.goto('/')
  await clearBrowserVault(page)
  await page.reload()
  await setupGithubProvider(page, pat, repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await expect(page.getByTestId('join-enrollment-dialog')).toBeVisible({
    timeout: 90_000,
  })
  await expect(page.getByTestId('join-enrollment-confirm')).toBeVisible()
}

export async function sendJoinRequest(
  page: Page,
  pat: string,
  repoName: string,
) {
  await page.getByTestId('join-enrollment-confirm').click()
  await expect(page.getByTestId('join-enrollment-dialog')).toContainText(
    'Waiting for approval',
    { timeout: 45_000 },
  )

  const snapshot = await waitForVaultYaml(
    pat,
    repoName,
    (yaml) => yaml.joinEntries.length >= 1 || joinCountFromYaml(yaml.raw) >= 1,
  )
  assertJoinPendingYaml(snapshot)
  const join = snapshot.joinEntries[0]

  await page.getByTestId('join-enrollment-dismiss').click()
  await expect(page.getByTestId('join-enrollment-dialog')).not.toBeVisible()

  return join
}

export async function waitForPendingJoinOnDevice(page: Page, deviceId: string) {
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })
  if (await row.isVisible()) {
    return
  }
  const refresh = page.getByTestId('refresh-joins-banner-btn')
  if (await refresh.isVisible()) {
    await refresh.click()
  }
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

export async function approveJoinFromBanner(page: Page, deviceId: string) {
  await waitForPendingJoinOnDevice(page, deviceId)
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })
  await row.getByTestId('approve-join-btn').click()
  await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
}

export async function approveJoinFromSettings(page: Page, deviceId: string) {
  await openStorageSettings(page)
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })

  if (!(await row.isVisible())) {
    await page.getByTestId('refresh-joins-btn').click()
  }
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await row.getByTestId('approve-join-btn').click()
  await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
  await page.getByTestId('storage-settings-close').click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

export async function unlockGithubVault(page: Page) {
  await page.goto('/')
  const vaultPanel = page.getByTestId('vault-panel')
  const autoUnlocked = await vaultPanel
    .waitFor({ state: 'visible', timeout: 90_000 })
    .then(() => true)
    .catch(() => false)
  if (autoUnlocked) {
    return
  }
  const unlock = page.getByTestId('unlock-vault-btn')
  if (await unlock.isVisible()) {
    await waitForEngine(page)
    await unlock.click()
  }
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: 90_000,
  })
}

/** Open storage settings (must already be connected). */
export async function openStorageSettings(page: Page) {
  await page.getByTestId('storage-settings-btn').click()
  await expect(page.getByTestId('storage-settings-panel')).toBeVisible()
  await expect(page.getByTestId('vault-panel')).not.toBeVisible()
}

/** Reconnect after reload — auto-unlocks when a saved provider exists. */
export async function reconnectGithubVault(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('vault-panel')).toBeVisible({ timeout: 90_000 })
}

export async function assertVaultReady(page: Page) {
  await expect(page.getByTestId('vault-panel')).toBeVisible()
}

export async function addSecret(page: Page, key: string, value: string) {
  await assertVaultReady(page)
  await page.getByTestId('add-secret-btn').click()
  await expect(page.getByTestId('add-secret-panel')).toBeVisible()
  await page.getByTestId('secret-label').fill(key)
  await page.getByTestId('secret-value').fill(value)
  await page.getByTestId('save-secret-btn').click()
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await expect(row).toBeVisible({ timeout: 90_000 })
  await expect(
    page.getByTestId('app-success').or(page.getByTestId('connect-success')),
  )
    .toContainText('Secret saved successfully', { timeout: 5_000 })
    .catch(() => undefined)
}

export async function revealSecretValue(page: Page, key: string) {
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await row.getByRole('button', { name: 'Show password' }).click()
  const code = row.locator('code')
  await expect(code).toBeVisible()
  return (await code.textContent()) ?? ''
}

export async function waitForSecretOnDevice(
  page: Page,
  key: string,
  timeoutMs = 60_000,
) {
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await row.isVisible()) {
      return
    }
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    if (!(await page.getByTestId('vault-panel').isVisible())) {
      await waitForVaultUnlocked(page)
    }
    await sleep(2_000)
  }
  await expect(row).toBeVisible({ timeout: 5_000 })
}

export async function deleteSecret(page: Page, key: string) {
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await row.getByRole('button', { name: 'Delete secret' }).click()
  await expect(page.getByTestId('app-success')).toContainText(
    'Secret deleted successfully',
    { timeout: 45_000 },
  )
  await expect(row).toHaveCount(0)
}

export async function assertGenesisVaultOnGithub(
  pat: string,
  repoName: string,
) {
  const snapshot = await waitForVaultYaml(
    pat,
    repoName,
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
  )
  assertGenesisVaultYaml(snapshot)
  return snapshot
}

export async function assertEnrolledVaultOnGithub(
  pat: string,
  repoName: string,
  expectedMembers: number,
) {
  const snapshot = await waitForVaultYaml(
    pat,
    repoName,
    (yaml) =>
      yaml.joinEntries.length === 0 &&
      yaml.authPkIds.length === expectedMembers &&
      yaml.memberPkIds.length === expectedMembers,
  )
  assertEnrolledVaultYaml(snapshot, expectedMembers)
  return snapshot
}
