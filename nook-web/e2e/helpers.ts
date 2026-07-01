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
import {
  fetchGithubVaultYaml,
  githubApiFetch,
  githubApiHeaders,
  githubFetch,
  githubRepoContext,
  GITHUB_VAULT_PATH,
} from './github-api'

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

let cachedE2eGithubRepoName: string | null = null

/**
 * One GitHub repo per Playwright container/run. CI sets NOOK_GITHUB_E2E_REPO per
 * docker:e2e:run (e.g. nook-e2e-github-$RUN_ID); local runs get a random nook-* repo.
 */
export function createE2eGithubRepoName(): string {
  if (cachedE2eGithubRepoName) {
    return cachedE2eGithubRepoName
  }

  const override = process.env.NOOK_GITHUB_E2E_REPO?.trim()
  if (override) {
    registerE2eGithubRepo(override)
    cachedE2eGithubRepoName = override
    return override
  }

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const repoName = `nook-${suffix}`
  registerE2eGithubRepo(repoName)
  cachedE2eGithubRepoName = repoName
  return repoName
}

/** UI actions we control should complete in a couple of seconds. */
export const UI_TIMEOUT_MS = 5_000
/** Password unlock / enrollment runs scrypt in wasm — allow more time on CI. */
export const ENROLLMENT_UNLOCK_TIMEOUT_MS = 30_000

/** Default password used by e2e create-vault and local-unlock helpers. */
export const DEFAULT_LOCAL_VAULT_PASSWORD = 'test-local-vault-password'

export async function openLoginProviderSetup(page: Page) {
  if (await page.getByTestId('provider-option-github').isVisible()) {
    return
  }

  const connectBtn = page.getByTestId('login-connect-storage-btn')
  const legacyLink = page.getByTestId('login-use-storage-provider-link')
  const addBtn = page.getByTestId('add-provider-btn')
  const providerSetup = page.getByTestId('login-provider-setup')

  await expect(
    connectBtn
      .or(legacyLink)
      .or(addBtn)
      .or(providerSetup)
      .or(page.getByTestId('provider-option-github')),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  if (await page.getByTestId('provider-option-github').isVisible()) {
    return
  }

  if (await providerSetup.isVisible()) {
    await expect(page.getByTestId('provider-option-github')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    return
  }

  if (await connectBtn.isVisible()) {
    await connectBtn.click()
  } else if (await legacyLink.isVisible()) {
    await legacyLink.click()
  } else {
    await addBtn.click()
  }

  await expect(page.getByTestId('provider-option-github')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** @deprecated Use {@link openLoginProviderSetup}. */
export const openLegacyProviderSetup = openLoginProviderSetup

export async function createLocalVaultOnLogin(page: Page) {
  await page.getByTestId('login-create-device-vault-btn').click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await disableVaultIdleLock(page)
}

export async function connectLocalVault(page: Page) {
  await page.goto('/')
  await expect(
    page.getByTestId('vault-panel').or(page.getByTestId('login-gate')),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })

  if (await page.getByTestId('vault-panel').isVisible()) {
    return
  }

  const chooser = page.getByTestId('login-create-vault-chooser')
  if (await chooser.isVisible()) {
    await createLocalVaultOnLogin(page)
    return
  }

  await unlockVaultOnLogin(page)
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** Device-key genesis via storage provider picker (e2e / migration fallback). */
export async function connectLocalVaultLegacy(page: Page) {
  await page.goto('/')
  await expect(
    page.getByTestId('vault-panel').or(page.getByTestId('login-gate')),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })

  if (await page.getByTestId('vault-panel').isVisible()) {
    await disableVaultIdleLock(page)
    return
  }

  const localUnlock = page.getByTestId('login-local-unlock-step')
  if (await localUnlock.isVisible()) {
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await disableVaultIdleLock(page)
    return
  }

  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-local').click()
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await disableVaultIdleLock(page)
}

export const BIP39_WORDLIST_ROUTE = '**/bip-0039/english.txt'

/** Valid BIP-39 test mnemonic (12 words). */
export const BIP39_SAMPLE_WORDS = [
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'abandon',
  'about',
] as const

export function buildBip39WordlistBody(
  leadingWords: readonly string[] = BIP39_SAMPLE_WORDS,
): string {
  const words = [...leadingWords]
  let index = words.length
  while (words.length < 2048) {
    words.push(`testword${index}`)
    index += 1
  }
  return words.join('\n')
}

export async function mockBip39Wordlist(
  page: Page,
  leadingWords: readonly string[] = BIP39_SAMPLE_WORDS,
) {
  const body = buildBip39WordlistBody(leadingWords)
  await page.route(BIP39_WORDLIST_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body,
    })
  })
}

export async function fillSeedPhraseGrid(page: Page, words: readonly string[]) {
  if (words.length === 24) {
    await page.getByTestId('seed-word-count-24').click()
  }
  for (let index = 0; index < words.length; index += 1) {
    await page.getByTestId(`seed-word-${index + 1}`).fill(words[index]!)
  }
}

export type GithubE2eTarget = {
  pat: string
  repoName: string
  /** In-memory GitHub REST stub — avoids api.github.com (PR/main CI). */
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>
}

function configuredVaultSyncIntervalMs(): number {
  const parsed = Number(process.env.VITE_VAULT_SYNC_INTERVAL_MS)
  if (Number.isFinite(parsed) && parsed >= 250) return parsed
  return 30_000
}

function configuredGithubPollIntervalMs(): number {
  const parsed = Number(process.env.NOOK_GITHUB_POLL_MS)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 3_000
}

function configuredGithubSyncTimeoutMs(): number {
  const parsed = Number(process.env.NOOK_GITHUB_SYNC_TIMEOUT_MS)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 15_000
}

function configuredGithubConnectTimeoutMs(): number {
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
const GITHUB_SYNC_TIMEOUT_MS = configuredGithubSyncTimeoutMs()
/** First connect may create the repo on GitHub. */
const GITHUB_CONNECT_TIMEOUT_MS = configuredGithubConnectTimeoutMs()
const GITHUB_SYNC_INTERVAL_MS = configuredGithubPollIntervalMs()

export { fetchGithubVaultYaml }

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** GitHub sync can briefly fail while a repo or vault file is still being created. */
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

function summarizeVaultError(text: string): string {
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

async function deleteGithubFileIfExists(
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
  const timeoutMs = options?.timeoutMs ?? GITHUB_SYNC_TIMEOUT_MS
  const intervalMs = options?.intervalMs ?? GITHUB_SYNC_INTERVAL_MS
  const deadline = Date.now() + timeoutMs
  let lastError = 'vault file missing'

  while (Date.now() < deadline) {
    if (options?.page) {
      await assertNoVaultErrors(options.page, { allowTransient: true })
    }
    const yaml = await fetchGithubVaultYaml(pat, repoName)
    if (yaml) {
      const snapshot = parseVaultYamlSnapshot(yaml)
      if (predicate(snapshot)) {
        return snapshot
      }
      lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, joins=${joinCountFromYaml(yaml)})`
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for vault YAML: ${lastError}`)
}

async function assertNoVaultErrors(
  page: Page,
  options?: { allowTransient?: boolean },
) {
  const vaultError = page.getByTestId('vault-error')
  if (!(await vaultError.isVisible())) {
    return
  }

  const text = ((await vaultError.textContent()) ?? '').trim()
  if (options?.allowTransient && isTransientVaultSyncError(text)) {
    console.warn(
      `[e2e] transient vault sync error (expected): ${summarizeVaultError(text)}`,
    )
    return
  }

  throw new Error(`Vault error: ${summarizeVaultError(text)}`)
}

const KNOWN_VAULT_FAILURE_PATTERNS = [
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
  const text = ((await vaultError.textContent()) ?? '').trim()
  if (
    KNOWN_VAULT_FAILURE_PATTERNS.some((pattern) => pattern.test(text)) ||
    text.length > 0
  ) {
    throw new Error(`Vault error: ${summarizeVaultError(text)}`)
  }
}

/** Click the vault sync refresh control when available. */
export async function triggerVaultSyncRefresh(page: Page) {
  await waitForVaultOperationsIdle(page)
  const refresh = page.getByTestId('vault-sync-refresh-btn')
  await expect(refresh).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect
    .poll(
      async () => {
        if (!(await refresh.isVisible())) return false
        return refresh.isEnabled()
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await refresh.click()
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

/** Wait until sync target has the expected vault state (stub or live GitHub). */
export async function waitForGithubVaultState(
  target: GithubE2eTarget,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number; page?: Page },
): Promise<VaultYamlSnapshot> {
  if (target.stub) {
    const { waitForStubVaultState } = await import('./sync-stub')
    return waitForStubVaultState(
      { pat: target.pat, repoName: target.repoName, stub: target.stub },
      predicate,
      options,
    )
  }
  return waitForVaultYaml(target.pat, target.repoName, predicate, options)
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

/**
 * Serial multi-device specs leave one browser idle while another acts; the e2e
 * idle timeout (2.5s) would auto-lock the waiting device and break sync flows.
 */
export async function disableVaultIdleLock(page: Page) {
  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: { stopIdleSessionTracking?: () => void }
      }
    ).__nookVault
    vault?.stopIdleSessionTracking?.()
  })
}

/** Stop periodic background sync so e2e can wait for in-flight work to finish. */
export async function pauseVaultBackgroundSync(page: Page) {
  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: { stopVaultSync?: () => void }
      }
    ).__nookVault
    vault?.stopVaultSync?.()
  })
}

/** Stop background sync timers and clear stuck sync flags (keeps idle lock active). */
export async function forceVaultSyncQuiescentForE2e(page: Page) {
  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: {
          stopVaultSync?: () => void
          isSyncing?: boolean
          isFanOutSyncing?: boolean
          syncingProviderId?: string | null
          isPasswordBusy?: boolean
        }
      }
    ).__nookVault
    if (!vault) return
    vault.stopVaultSync?.()
    vault.isSyncing = false
    vault.isFanOutSyncing = false
    vault.syncingProviderId = null
    vault.isPasswordBusy = false
  })
}

/** Stop timers and clear stuck sync flags so wasm storage ops can proceed in e2e. */
export async function forceVaultQuiescentForE2e(page: Page) {
  await page.evaluate(() => {
    const vault = (
      window as Window & {
        __nookVault?: {
          stopVaultSync?: () => void
          stopIdleSessionTracking?: () => void
          isSyncing?: boolean
          isFanOutSyncing?: boolean
          syncingProviderId?: string | null
          isPasswordBusy?: boolean
        }
      }
    ).__nookVault
    if (!vault) return
    vault.stopVaultSync?.()
    vault.stopIdleSessionTracking?.()
    vault.isSyncing = false
    vault.isFanOutSyncing = false
    vault.syncingProviderId = null
    vault.isPasswordBusy = false
  })
}

/** Wait for the wasm storage queue to drain; reset if it stalls (e2e dev build). */
export async function waitForStorageChainIdle(
  page: Page,
  timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const drained = await page.evaluate(async () => {
      const vault = (
        window as Window & {
          __nookVault?: {
            waitForStorageChain?: () => Promise<void>
          }
        }
      ).__nookVault
      if (!vault?.waitForStorageChain) return true
      return Promise.race([
        vault.waitForStorageChain().then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 500)
        }),
      ])
    })
    if (drained) return
  }
  await page.evaluate(() => {
    ;(
      window as Window & {
        __nookVault?: { resetStorageChain?: () => void }
      }
    ).__nookVault?.resetStorageChain?.()
  })
}

/** Wait until unlock/save/password wasm work has finished (e2e dev build). */
export async function waitForVaultOperationsIdle(
  page: Page,
  timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS,
) {
  await pauseVaultBackgroundSync(page)
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const vault = (
            window as Window & {
              __nookVault?: {
                isVerifying?: boolean
                isSaving?: boolean
                isPasswordBusy?: boolean
              }
            }
          ).__nookVault
          if (!vault) return true
          return !vault.isVerifying && !vault.isSaving && !vault.isPasswordBusy
        }),
      { timeout: timeoutMs },
    )
    .toBe(true)
  await waitForStorageChainIdle(page, timeoutMs)
  await forceVaultSyncQuiescentForE2e(page)
}

/** Wait until background vault sync / fan-out is idle (e2e dev build only). */
export async function waitForVaultSyncIdle(
  page: Page,
  timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS,
) {
  await pauseVaultBackgroundSync(page)
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const vault = (
            window as Window & {
              __nookVault?: { isSyncActivityVisible?: boolean }
            }
          ).__nookVault
          return vault ? !vault.isSyncActivityVisible : true
        }),
      { timeout: timeoutMs },
    )
    .toBe(true)
}

export function uniqueSecretKey(prefix: string) {
  return `${prefix}-${Date.now()}`
}

export async function waitForEngine(page: Page) {
  const button = page.getByTestId('connect-provider-btn')
  await expect(button.first()).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(button.first()).not.toContainText('Loading engine', {
    timeout: UI_TIMEOUT_MS,
  })
  return button.first()
}

async function assertGithubConnected(page: Page) {
  await assertNoVaultErrors(page, { allowTransient: true })
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await disableVaultIdleLock(page)
}

async function setupGithubProvider(page: Page, pat: string, repoName: string) {
  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-github').click()
  await page.getByTestId('github-repo-input').fill(repoName)
  await page.getByTestId('github-pat-input').fill(pat)
}

export async function waitForVaultUnlocked(
  page: Page,
  timeout = UI_TIMEOUT_MS,
) {
  await expect(page.getByTestId('vault-panel')).toBeVisible({ timeout })
}

export async function connectGithubVault(
  page: Page,
  pat: string,
  repoName = DEFAULT_GITHUB_REPO,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  const target = { pat, repoName, stub }
  if (stub) {
    await stub.install(page, { repoName })
  }
  await page.goto('/')
  await setupGithubProvider(page, pat, repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForGithubVaultState(
    target,
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
    { page, timeoutMs: GITHUB_CONNECT_TIMEOUT_MS },
  )
  await assertGithubConnected(page)
}

/** Genesis device: fresh browser + GitHub repo → connected vault. */
export async function connectGithubGenesisDevice(
  page: Page,
  pat: string,
  repoName: string,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  await page.goto('/')
  await clearBrowserVault(page)
  await page.reload()
  await connectGithubVault(page, pat, repoName, stub)
}

/** Joiner connect runs GitHub assess + wasm — allow the same budget as genesis connect. */
async function waitForJoinEnrollmentDialog(page: Page) {
  const joinDialog = page.getByTestId('join-enrollment-dialog')
  await expect
    .poll(
      async () => {
        await assertNoVaultErrors(page, { allowTransient: true })
        if (await joinDialog.isVisible()) return 'join'
        if (await page.getByTestId('login-password-entry-list').isVisible()) {
          return 'password'
        }
        return 'waiting'
      },
      { timeout: GITHUB_CONNECT_TIMEOUT_MS },
    )
    .toBe('join')
  await expect(page.getByTestId('join-enrollment-confirm')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

/** Second device: same repo → join enrollment dialog. */
export async function connectGithubJoinerDevice(
  page: Page,
  pat: string,
  repoName: string,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  const target = { pat, repoName, stub }
  await assertGenesisVaultOnGithub(target)
  if (stub) {
    await stub.install(page, { repoName })
  }
  await page.goto('/')
  await clearBrowserVault(page)
  await page.reload()
  await setupGithubProvider(page, pat, repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForJoinEnrollmentDialog(page)
}

export async function sendJoinRequest(
  page: Page,
  pat: string,
  repoName: string,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  await page.getByTestId('join-enrollment-confirm').click()
  await waitForVaultOperationsIdle(page)
  await waitForStorageChainIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)

  const snapshot = await waitForGithubVaultState(
    { pat, repoName, stub },
    (yaml) => yaml.joinEntries.length >= 1 || joinCountFromYaml(yaml.raw) >= 1,
    { page, timeoutMs: GITHUB_CONNECT_TIMEOUT_MS },
  )
  assertJoinPendingYaml(snapshot)
  const join = snapshot.joinEntries[0]

  await expect(page.getByTestId('join-enrollment-dialog')).toContainText(
    'Waiting for approval',
    { timeout: UI_TIMEOUT_MS },
  )

  await page.getByTestId('join-enrollment-dismiss').click()
  await expect(page.getByTestId('join-enrollment-dialog')).not.toBeVisible()

  return join
}

export async function waitForPendingJoinOnDevice(page: Page, deviceId: string) {
  await waitForPendingJoinBanner(page, deviceId)
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

/** Wait until pending joins are visible on an enrolled device (manual sync + banner). */
export async function waitForPendingJoinBanner(page: Page, deviceId?: string) {
  await expect
    .poll(
      async () => {
        await dismissSyncConflictIfVisible(page)
        await page.evaluate(async () => {
          const vault = (
            window as Window & {
              __nookVault?: {
                refreshPendingJoinsFromProviders?: () => Promise<void>
              }
            }
          ).__nookVault
          await vault?.refreshPendingJoinsFromProviders?.()
        })
        try {
          await triggerVaultSyncRefresh(page)
        } catch {
          await page.evaluate(async () => {
            const vault = (
              window as Window & {
                __nookVault?: { manualSync?: () => Promise<void> }
              }
            ).__nookVault
            await vault?.manualSync?.()
          })
        }
        await waitForVaultOperationsIdle(page)
        if (deviceId) {
          const row = page
            .getByTestId('device-join-row')
            .filter({ hasText: deviceId })
          if (await row.isVisible()) return true
        }
        if (await page.getByTestId('pending-joins-banner').isVisible()) {
          return true
        }
        const pending = await page.evaluate(() => {
          const vault = (
            window as Window & {
              __nookVault?: { pendingJoins?: unknown[] }
            }
          ).__nookVault
          return vault?.pendingJoins?.length ?? 0
        })
        return pending > 0
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await expect(page.getByTestId('pending-joins-banner')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

export async function approveJoinFromBanner(
  page: Page,
  deviceId: string,
  target: GithubE2eTarget,
  expectedMembers: number,
) {
  await waitForPendingJoinOnDevice(page, deviceId)
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })
  await row.getByTestId('approve-join-btn').click()
  await assertEnrolledVaultOnGithub(target, expectedMembers, undefined, page)
  await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
}

export async function approveJoinFromSettings(
  page: Page,
  deviceId: string,
  target: GithubE2eTarget,
  expectedMembers: number,
) {
  await openStorageSettings(page)
  await expandSettingsSection(page, 'devices')
  await waitForPendingJoinInSettings(page, deviceId)
  const row = page.getByTestId('pending-join-row').filter({ hasText: deviceId })
  await row.getByTestId('approve-join-btn').click()
  await assertEnrolledVaultOnGithub(target, expectedMembers, undefined, page)
  await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
}

async function waitForPendingJoinInSettings(page: Page, deviceId: string) {
  const row = page.getByTestId('pending-join-row').filter({ hasText: deviceId })
  await expect
    .poll(
      async () => {
        await page.evaluate(async () => {
          const vault = (
            window as Window & {
              __nookVault?: {
                refreshPendingJoinsFromProviders?: () => Promise<void>
              }
            }
          ).__nookVault
          await vault?.refreshPendingJoinsFromProviders?.()
        })
        if (await row.isVisible()) return true
        try {
          await triggerVaultSyncRefresh(page)
        } catch {
          // Sync control may still be disabled while background work finishes.
        }
        return row.isVisible()
      },
      { timeout: configuredGithubSyncTimeoutMs() },
    )
    .toBe(true)
}

async function dismissJoinEnrollmentDialog(page: Page) {
  for (const testId of ['join-enrollment-dismiss', 'join-enrollment-close']) {
    const button = page.getByTestId(testId)
    if (await button.isVisible()) {
      await button.click()
    }
  }
}

/** Pull remote vault state on the login gate (joiner waiting for / after approval). */
async function refreshGithubVaultOnLoginGate(page: Page) {
  await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: {
          syncFromStorage?: (opts?: { force?: boolean }) => Promise<void>
        }
      }
    ).__nookVault
    await vault?.syncFromStorage?.({ force: true })
  })
  await waitForVaultOperationsIdle(page)
}

async function tryGithubVaultConnect(page: Page, target: GithubE2eTarget) {
  await refreshGithubVaultOnLoginGate(page)
  await dismissSyncConflictIfVisible(page)
  await dismissJoinEnrollmentDialog(page)

  const quickConnect = page.getByTestId('connect-provider-btn').first()
  if (await quickConnect.isVisible()) {
    if (await quickConnect.isEnabled()) {
      await quickConnect.click()
      await waitForVaultOperationsIdle(page)
    }
    return
  }
  if (await page.getByTestId('login-provider-setup').isVisible()) {
    await page.getByTestId('provider-option-github').click()
    const repoInput = page.getByTestId('github-repo-input')
    if (await repoInput.isVisible()) {
      await repoInput.fill(target.repoName)
      await page.getByTestId('github-pat-input').fill(target.pat)
    }
    const connectButton = await waitForEngine(page)
    await connectButton.click()
    await waitForVaultOperationsIdle(page)
    return
  }
  await setupGithubProvider(page, target.pat, target.repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForVaultOperationsIdle(page)
}

export async function waitForJoinerVaultReady(
  page: Page,
  target: GithubE2eTarget,
) {
  if (target.stub) {
    await target.stub.install(page, { repoName: target.repoName })
  }
  await expect
    .poll(
      async () => {
        await refreshGithubVaultOnLoginGate(page)
        await dismissSyncConflictIfVisible(page)
        await dismissJoinEnrollmentDialog(page)
        if (
          (await page.getByTestId('vault-panel').isVisible()) ||
          (await page.getByTestId('secret-row').count()) > 0
        ) {
          return true
        }
        await tryGithubVaultConnect(page, target)
        return (
          (await page.getByTestId('vault-panel').isVisible()) ||
          (await page.getByTestId('secret-row').count()) > 0
        )
      },
      { timeout: GITHUB_CONNECT_TIMEOUT_MS },
    )
    .toBe(true)
  await disableVaultIdleLock(page)
}

export async function unlockGithubVault(page: Page, target?: GithubE2eTarget) {
  if (target?.stub) {
    await target.stub.install(page, { repoName: target.repoName })
  }
  await page.goto('/')
  await dismissSyncConflictIfVisible(page)
  await dismissJoinEnrollmentDialog(page)

  const vaultReady = async () =>
    (await page.getByTestId('vault-panel').isVisible()) ||
    (await page.getByTestId('secret-row').count()) > 0

  await expect(
    page.getByTestId('login-gate').or(page.getByTestId('vault-panel')),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  if (await vaultReady()) {
    await disableVaultIdleLock(page)
    return
  }

  if (await page.getByTestId('login-local-unlock-step').isVisible()) {
    await unlockVaultOnLogin(page)
  } else if (target) {
    await tryGithubVaultConnect(page, target)
    await assertNoVaultErrors(page, { allowTransient: true })
    await dismissSyncConflictIfVisible(page)
    await dismissJoinEnrollmentDialog(page)
  } else if (await page.getByTestId('login-gate').isVisible()) {
    await connectLoginProvider(page)
    if (
      !(await vaultReady()) &&
      (await page.getByTestId('login-local-unlock-step').isVisible())
    ) {
      await unlockVaultOnLogin(page)
    }
  }

  await expect
    .poll(
      async () => {
        if (await vaultReady()) return true
        await dismissSyncConflictIfVisible(page)
        await dismissJoinEnrollmentDialog(page)
        if (target) {
          await tryGithubVaultConnect(page, target)
        }
        return vaultReady()
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await disableVaultIdleLock(page)
}

/** Expand the login enrollment accordion on the login gate. */
export async function expandLoginEnrollmentPanel(page: Page) {
  const toggle = page.getByTestId('login-enrollment-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
}

/** Open storage settings (must already be connected). */
export async function openStorageSettings(page: Page) {
  await page.getByTestId('vault-settings-tab').click()
  await expect(page.getByTestId('storage-settings-panel')).toBeVisible()
  await expect(page.getByTestId('vault-panel')).not.toBeVisible()
}

const SETTINGS_SECTION_TEST_IDS = {
  storage: 'storage-providers-section',
  unlock: 'vault-unlock-section',
  devices: 'vault-devices-section',
} as const

export type SettingsSection = keyof typeof SETTINGS_SECTION_TEST_IDS

/** Expand one vault settings accordion section (only one open at a time). */
export async function expandSettingsSection(
  page: Page,
  section: SettingsSection,
) {
  const sectionEl = page.getByTestId(SETTINGS_SECTION_TEST_IDS[section])
  const toggle = sectionEl.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
}

export async function addVaultPassword(
  page: Page,
  label: string,
  password: string,
  options?: { expectedCount?: number },
) {
  const expectedCount = options?.expectedCount ?? 1
  await expandSettingsSection(page, 'unlock')
  await page.getByTestId('set-vault-password-btn').click()
  await page.getByTestId('vault-password-label').fill(label)
  await page.getByTestId('vault-password-input').fill(password)
  await page.getByTestId('vault-password-confirm').fill(password)
  await page.getByTestId('submit-vault-password').click()
  await expect(page.getByTestId('app-success')).toContainText(/password/i, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await waitForVaultOperationsIdle(page)
  await waitForStableLocalVaultState(
    page,
    (snapshot) => snapshot.hasPasswordEnvelope,
    { timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS, stableReads: 2 },
  )
  await expectVaultPasswordStatus(page, expectedCount, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** Rotate the active backup password and wait for a new envelope in local IDB. */
export async function rotateVaultPassword(page: Page, password: string) {
  await expandSettingsSection(page, 'unlock')
  await page.getByTestId('rotate-vault-password-btn').click()
  await page.getByTestId('vault-password-input').fill(password)
  await page.getByTestId('vault-password-confirm').fill(password)
  await page.getByTestId('submit-vault-password').click()
  await expect(page.getByTestId('app-success')).toContainText(/password/i, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expectVaultPasswordStatus(page, 1, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** Poll local vault YAML until predicate holds for several consecutive reads. */
export async function waitForStableLocalVaultState(
  page: Page,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: {
    timeoutMs?: number
    intervalMs?: number
    stableReads?: number
  },
): Promise<VaultYamlSnapshot> {
  const timeoutMs = options?.timeoutMs ?? ENROLLMENT_UNLOCK_TIMEOUT_MS
  const intervalMs = options?.intervalMs ?? 500
  const stableReads = options?.stableReads ?? 3
  const deadline = Date.now() + timeoutMs
  let consecutive = 0
  let lastError = 'local vault missing'

  while (Date.now() < deadline) {
    const yaml = await readLocalVaultYamlFromIdb(page)
    if (yaml.trim()) {
      const snapshot = parseVaultYamlSnapshot(yaml)
      if (predicate(snapshot)) {
        consecutive += 1
        if (consecutive >= stableReads) {
          return snapshot
        }
      } else {
        consecutive = 0
        lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, passwords=${snapshot.hasPasswordEnvelope})`
      }
    } else {
      consecutive = 0
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for stable local vault YAML: ${lastError}`)
}

/** Match vault password badge copy (`1 item` or legacy `1 password`). */
export async function dismissSyncConflictIfVisible(page: Page) {
  const dialog = page.getByTestId('vault-sync-conflict-dialog')
  if (!(await dialog.isVisible())) return
  await page.getByTestId('sync-conflict-keep-local-btn').click()
  await expect(dialog).not.toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

export async function expectVaultPasswordStatus(
  page: Page,
  count: number | 'none',
  options?: { timeout?: number },
) {
  await expandSettingsSection(page, 'unlock')
  const status = page
    .getByTestId('vault-unlock-section')
    .getByTestId('vault-password-status')
  const timeout = options?.timeout ?? UI_TIMEOUT_MS
  if (count === 'none') {
    await expect(status).toContainText('None', { timeout })
    return
  }
  if (count === 1) {
    await expect(status).toContainText(/1 (password|item)/, { timeout })
    return
  }
  await expect(status).toContainText(new RegExp(`${count} (passwords|items)`), {
    timeout,
  })
}

/** Issue an onboard enrollment code and return the code textarea locator. */
export async function submitOnboardEnrollmentCode(
  page: Page,
  password: string,
) {
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  await forceVaultQuiescentForE2e(page)
  await expect(page.getByTestId('onboard-device-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await dismissSyncConflictIfVisible(page)
  await expect(page.getByTestId('onboard-device-submit')).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('onboard-password-input').fill(password)
  await page.getByTestId('onboard-device-submit').click()

  const codeArea = page.getByTestId('onboard-code')
  const error = page.getByTestId('onboard-error')
  await expect(codeArea.or(error)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await error.isVisible()) {
    throw new Error(
      `Onboard enrollment failed: ${(await error.textContent())?.trim() ?? 'unknown error'}`,
    )
  }
  return codeArea
}

/** Open the onboard-device settings view with sync timers paused for e2e. */
export async function openOnboardDevicePanel(page: Page) {
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  await forceVaultQuiescentForE2e(page)
  await page.getByTestId('vault-onboard-tab').click()
  await expect(page.getByTestId('onboard-device-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

/** Reconnect after reload — unlock via login gate when auto-unlock is off. */
export async function reconnectGithubVault(page: Page) {
  await unlockGithubVault(page)
}

export async function assertVaultReady(page: Page) {
  await expect(page.getByTestId('authenticated-shell')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** Start a GitHub connect from the login gate (saved provider or fresh setup). */
export async function clickLoginConnectProvider(
  page: Page,
  preferred: 'local' | 'github' = 'github',
) {
  await openLoginProviderSetup(page)
  if (preferred === 'github') {
    const savedGithub = page.getByTestId('saved-provider-github').first()
    if (await savedGithub.isVisible()) {
      await savedGithub.click()
    }
    await page.getByTestId('provider-option-github').click()
  } else {
    await page.getByTestId('provider-option-local').click()
  }
  const connectButton = await waitForEngine(page)
  await connectButton.click()
}

/** Connect a saved provider on the login gate and reach unlock or vault. */
export async function connectLoginProvider(page: Page) {
  await clickLoginConnectProvider(page)
  await expect(
    page
      .getByTestId('login-local-unlock-step')
      .or(page.getByTestId('vault-panel')),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

export async function assertRemoteVaultRecoveryPanel(
  page: Page,
  options: { withLocalCache: boolean },
) {
  await expect(page.getByTestId('remote-vault-recovery-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  if (options.withLocalCache) {
    await expect(page.getByTestId('remote-vault-recover-btn')).toBeVisible()
  } else {
    await expect(page.getByTestId('remote-vault-recover-btn')).not.toBeVisible()
  }
}

/** Choose recover-from-browser on the remote-missing prompt, then reach unlock. */
export async function recoverRemoteVaultOnLogin(page: Page) {
  await page.getByTestId('remote-vault-recover-btn').click()
  await expect(
    page
      .getByTestId('login-local-unlock-step')
      .or(page.getByTestId('vault-panel')),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

/** Choose create-fresh on the remote-missing prompt, then reach unlock. */
export async function createFreshRemoteVaultOnLogin(page: Page) {
  await page.getByTestId('remote-vault-create-fresh-btn').click()
  await expect(
    page
      .getByTestId('login-local-unlock-step')
      .or(page.getByTestId('vault-panel')),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })
}

/** Remove browser-local vault mirrors (`vault_cache:*`) while keeping device identity. */
export async function deleteAllVaultLocalCaches(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_db', 1)
        request.onerror = () =>
          reject(request.error ?? new Error('idb open failed'))
        request.onsuccess = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('vault')) {
            db.close()
            resolve()
            return
          }
          const tx = db.transaction('vault', 'readwrite')
          const store = tx.objectStore('vault')
          const keysReq = store.getAllKeys()
          keysReq.onerror = () =>
            reject(keysReq.error ?? new Error('idb keys failed'))
          keysReq.onsuccess = () => {
            for (const key of keysReq.result) {
              if (typeof key === 'string' && key.startsWith('vault_cache:')) {
                store.delete(key)
              }
            }
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
        }
      }),
  )
}

export async function revealSecretInRow(
  row: import('@playwright/test').Locator,
) {
  const toggle = row.getByTestId('secret-row-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await row.getByRole('button', { name: 'Show secret' }).click()
}

export async function selectLoginUnlockMethod(
  page: Page,
  method: 'keys' | 'password',
) {
  const button = page.getByTestId(`login-unlock-method-${method}`)
  await expect(button).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await button.click()
}

/** Unlock from the login gate — optional password when device keys are unavailable. */
export async function unlockVaultOnLogin(
  page: Page,
  opts?: { password?: string; entryLabel?: string },
) {
  const localUnlock = page.getByTestId('login-local-unlock-step')
  if (await localUnlock.isVisible()) {
    if (opts?.password) {
      await selectLoginUnlockMethod(page, 'password')
      if (opts.entryLabel) {
        await page
          .getByTestId('login-password-entry-list')
          .getByRole('button', { name: opts.entryLabel })
          .click()
      }
      await page.getByTestId('login-password-input').fill(opts.password)
    } else {
      const keysMethod = page.getByTestId('login-unlock-method-keys')
      if (await keysMethod.isVisible()) {
        const checked = await keysMethod.getAttribute('aria-checked')
        if (checked !== 'true') {
          await selectLoginUnlockMethod(page, 'keys')
        }
      }
    }
    const unlockBtn = page.getByTestId('unlock-vault-btn')
    const vaultPanel = page.getByTestId('vault-panel')
    if (await vaultPanel.isVisible()) {
      return
    }
    await expect(unlockBtn).toBeEnabled({ timeout: UI_TIMEOUT_MS })
    if (await vaultPanel.isVisible()) {
      return
    }
    await dismissSyncConflictIfVisible(page)
    await unlockBtn.click()
    return
  }

  throw new Error(
    'Login gate has no local unlock step — use createLocalVaultOnLogin or clickLoginConnectProvider.',
  )
}

/**
 * Add a saved sync provider so `VaultState.shouldAutoUnlock()` stays false
 * and the login gate remains visible after reload.
 */
export async function disableLoginAutoUnlock(page: Page) {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('nook_auth', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('auth', 'readwrite')
        const store = tx.objectStore('auth')
        const getReq = store.get('providers')
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          const snapshot = getReq.result as {
            providers: Array<{
              id: string
              type: string
              label: string
              githubPat?: string
              githubRepo?: string
              createdAt: string
            }>
          } | null
          if (!snapshot?.providers?.length) {
            reject(new Error('No saved providers in nook_auth.'))
            return
          }
          snapshot.providers.push({
            id: 'e2e-dummy-github-sync',
            type: 'github',
            label: 'GitHub (e2e auto-unlock block)',
            githubPat: 'ghp_e2e_dummy',
            githubRepo: 'nook-e2e-dummy',
            createdAt: new Date().toISOString(),
          })
          const putReq = store.put(snapshot, 'providers')
          putReq.onerror = () =>
            reject(putReq.error ?? new Error('idb write failed'))
          putReq.onsuccess = () => undefined
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
      }
    })
  })
}

/** Remove the invalid dummy GitHub provider added by {@link disableLoginAutoUnlock}. */
export async function removeE2eDummyGithubSyncProvider(page: Page) {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('nook_auth', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('auth', 'readwrite')
        const store = tx.objectStore('auth')
        const getReq = store.get('providers')
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          const snapshot = getReq.result as {
            providers: Array<{ id: string }>
          } | null
          if (!snapshot?.providers) {
            resolve()
            return
          }
          snapshot.providers = snapshot.providers.filter(
            (provider) => provider.id !== 'e2e-dummy-github-sync',
          )
          const putReq = store.put(snapshot, 'providers')
          putReq.onerror = () =>
            reject(putReq.error ?? new Error('idb write failed'))
          putReq.onsuccess = () => undefined
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
      }
    })
  })
}

/**
 * Add extra GitHub providers to the saved auth snapshot for onboarding UI tests.
 */
export async function seedExtraGithubProviders(
  page: Page,
  extras: Array<{
    id: string
    label: string
    githubRepo: string
    githubPat: string
  }>,
) {
  await page.evaluate((providers) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('nook_auth', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('auth', 'readwrite')
        const store = tx.objectStore('auth')
        const getReq = store.get('providers')
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          const existing = getReq.result as {
            providers: Array<{
              id: string
              type: string
              label: string
              githubRepo?: string
              githubPat?: string
              createdAt: string
            }>
          } | null
          const snapshot = existing ?? { providers: [] }
          for (const provider of providers) {
            snapshot.providers.push({
              id: provider.id,
              type: 'github',
              label: provider.label,
              githubRepo: provider.githubRepo,
              githubPat: provider.githubPat,
              createdAt: new Date().toISOString(),
            })
          }
          const putReq = store.put(snapshot, 'providers')
          putReq.onerror = () =>
            reject(putReq.error ?? new Error('idb write failed'))
          putReq.onsuccess = () => undefined
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
      }
    })
  }, extras)

  await page.waitForFunction(
    (expectedIds) => {
      return new Promise<boolean>((resolve) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onerror = () => resolve(false)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readonly')
          const store = tx.objectStore('auth')
          const getReq = store.get('providers')
          getReq.onerror = () => resolve(false)
          getReq.onsuccess = () => {
            const snapshot = getReq.result as {
              providers?: Array<{ id: string; type: string }>
            } | null
            const ids = new Set(snapshot?.providers?.map((p) => p.id) ?? [])
            resolve(expectedIds.every((id) => ids.has(id)))
          }
          tx.oncomplete = () => db.close()
        }
      })
    },
    extras.map((p) => p.id),
    { timeout: UI_TIMEOUT_MS },
  )
}

/** Default GitHub sync provider for local e2e onboarding / fan-out specs. */
export const E2E_GITHUB_ONBOARD_PROVIDER = {
  id: 'e2e-onboard-github',
  label: 'GitHub (e2e onboard)',
  githubRepo: 'nook-e2e-onboard',
  githubPat: 'ghp_test_token',
}

/** Read canonical local vault YAML bytes stored in IndexedDB. */
export async function readLocalVaultYamlFromIdb(page: Page): Promise<string> {
  return page.evaluate(() => {
    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('nook_db', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('vault', 'readonly')
        const store = tx.objectStore('vault')
        const getReq = store.get('encrypted_db')
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          resolve(String(getReq.result ?? ''))
        }
        tx.oncomplete = () => db.close()
      }
    })
  })
}

/** Poll local vault YAML until predicate passes (local-first canonical copy). */
export async function waitForLocalVaultState(
  page: Page,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const timeoutMs = options?.timeoutMs ?? ENROLLMENT_UNLOCK_TIMEOUT_MS
  const intervalMs = options?.intervalMs ?? 500
  const deadline = Date.now() + timeoutMs
  let lastError = 'local vault missing'

  while (Date.now() < deadline) {
    const yaml = await readLocalVaultYamlFromIdb(page)
    if (yaml.trim()) {
      const snapshot = parseVaultYamlSnapshot(yaml)
      if (predicate(snapshot)) {
        return snapshot
      }
      lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, passwords=${snapshot.hasPasswordEnvelope})`
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for local vault YAML: ${lastError}`)
}

/** Stub GitHub REST responses so local e2e can exercise sync-provider enrollment. */
export async function stubGithubVaultForLocalE2e(
  page: Page,
  opts: { repoName: string; vaultYaml?: string; username?: string },
  existingStub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  const stub =
    existingStub ?? createLocalE2eGithubVaultStub(opts.vaultYaml ?? '')
  if (opts.vaultYaml !== undefined && !existingStub) {
    stub.setVaultYaml(opts.vaultYaml)
  }
  await stub.install(page, opts)
}

function listGithubStubDir(
  eventFiles: Map<string, string>,
  relativePath: string,
): Array<{ name: string; path: string; type: 'file' | 'dir' }> {
  const dirPrefix = relativePath.endsWith('/')
    ? relativePath
    : `${relativePath}/`
  const dirs = new Set<string>()
  const files = new Set<string>()
  for (const storedPath of eventFiles.keys()) {
    if (!storedPath.startsWith(dirPrefix)) continue
    const rest = storedPath.slice(dirPrefix.length)
    const slash = rest.indexOf('/')
    if (slash >= 0) {
      dirs.add(rest.slice(0, slash))
    } else if (rest) {
      files.add(rest)
    }
  }
  return [
    ...[...dirs].sort().map((name) => ({
      name,
      path: `${relativePath}/${name}`,
      type: 'dir' as const,
    })),
    ...[...files].sort().map((name) => ({
      name,
      path: `${relativePath}/${name}`,
      type: 'file' as const,
    })),
  ]
}

/** In-memory GitHub vault stub with GET/PUT support for local multi-device e2e. */
export function createLocalE2eGithubVaultStub(initialYaml = '') {
  let vaultYaml = initialYaml
  let sha = 'e2e-stub-sha'
  const eventFiles = new Map<string, string>()
  const eventShas = new Map<string, string>()

  return {
    getVaultYaml: () => vaultYaml,
    setVaultYaml: (yaml: string) => {
      vaultYaml = yaml
    },
    getEventFileCount: () => eventFiles.size,
    getEventFilePaths: () => [...eventFiles.keys()],
    async install(
      page: Page,
      opts: { repoName: string; vaultYaml?: string; username?: string },
    ) {
      if (opts.vaultYaml !== undefined) {
        vaultYaml = opts.vaultYaml
      }
      const owner = opts.username ?? 'e2e-user'
      const fullRepo = `${owner}/${opts.repoName}`

      await page.route('https://api.github.com/**', async (route) => {
        const request = route.request()
        const url = request.url().split('?')[0]!
        const method = request.method()

        if (url === 'https://api.github.com/user') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ login: owner }),
          })
          return
        }
        if (url === `https://api.github.com/repos/${fullRepo}`) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: 1, name: opts.repoName, private: true }),
          })
          return
        }
        const contentsPrefix = `https://api.github.com/repos/${fullRepo}/contents/`
        if (url === contentsPrefix) {
          const files: Array<{ name: string; path: string; type: string }> = []
          if (vaultYaml.trim().length > 0) {
            files.push({
              name: 'nook-vault.yaml',
              path: 'nook-vault.yaml',
              type: 'file',
            })
          }
          if (eventFiles.size > 0) {
            files.push({
              name: 'nook-log',
              path: 'nook-log',
              type: 'dir',
            })
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(files),
          })
          return
        }
        if (
          url ===
          `https://api.github.com/repos/${fullRepo}/contents/nook-vault.yaml`
        ) {
          if (method === 'PUT') {
            const body = request.postDataJSON() as {
              content?: string
              sha?: string
            }
            if (body.content) {
              vaultYaml = Buffer.from(body.content, 'base64').toString('utf8')
              sha = `e2e-stub-sha-${Date.now()}`
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                content: { sha },
              }),
            })
            return
          }
          if (!vaultYaml.trim()) {
            await route.fulfill({ status: 404, body: '{}' })
            return
          }
          const encoded = Buffer.from(vaultYaml, 'utf8').toString('base64')
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              content: encoded,
              sha,
              encoding: 'base64',
            }),
          })
          return
        }
        if (url.startsWith(`${contentsPrefix}nook-log/`)) {
          const relativePath = url.slice(contentsPrefix.length)
          if (method === 'PUT') {
            const body = request.postDataJSON() as { content?: string }
            if (body.content) {
              const decoded = Buffer.from(body.content, 'base64').toString(
                'utf8',
              )
              eventFiles.set(relativePath, decoded)
              eventShas.set(
                relativePath,
                `e2e-event-sha-${Date.now()}-${relativePath.length}`,
              )
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                content: {
                  sha: eventShas.get(relativePath) ?? sha,
                },
              }),
            })
            return
          }
          const stored = eventFiles.get(relativePath)
          if (stored !== undefined) {
            const encoded = Buffer.from(stored, 'utf8').toString('base64')
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                content: encoded,
                sha: eventShas.get(relativePath) ?? sha,
                encoding: 'base64',
              }),
            })
            return
          }
          const listing = listGithubStubDir(eventFiles, relativePath)
          if (listing.length === 0) {
            await route.fulfill({ status: 404, body: '{}' })
            return
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(listing),
          })
          return
        }
        if (method === 'PUT' && url.includes(`/repos/${fullRepo}/contents/`)) {
          sha = `e2e-stub-sha-${Date.now()}`
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ content: { sha } }),
          })
          return
        }
        await route.fulfill({ status: 404, body: '{}' })
      })
    },
  }
}

/** Seed sync provider + unlock a keys-mode local vault for multi-device local e2e. */
export async function reloadUnlockLocalVaultWithGithubSync(
  page: Page,
  sharedStub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  await seedExtraGithubProviders(page, [E2E_GITHUB_ONBOARD_PROVIDER])

  const vaultYaml = await readLocalVaultYamlFromIdb(page)
  if (vaultYaml.trim()) {
    await stubGithubVaultForLocalE2e(
      page,
      {
        repoName: E2E_GITHUB_ONBOARD_PROVIDER.githubRepo,
        vaultYaml,
      },
      sharedStub,
    )
  }

  await page.reload()

  if (vaultYaml.trim()) {
    await stubGithubVaultForLocalE2e(
      page,
      {
        repoName: E2E_GITHUB_ONBOARD_PROVIDER.githubRepo,
        vaultYaml,
      },
      sharedStub,
    )
  }

  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await selectLoginUnlockMethod(page, 'keys')
  await page.getByTestId('unlock-vault-btn').click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await disableVaultIdleLock(page)
  await dismissSyncConflictIfVisible(page)
  await waitForVaultOperationsIdle(page)
  await forceVaultQuiescentForE2e(page)
  await waitForLoadedSyncProviders(page)
  await waitForVaultSyncIdle(page)
}

/** Connect a joiner browser to a stubbed GitHub repo (keys-mode join dialog). */
export async function connectLocalE2eJoinerDevice(
  page: Page,
  repoName: string,
) {
  await page.goto('/')
  await clearBrowserVault(page)
  await page.reload()
  await setupGithubProvider(page, 'ghp_test_token', repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForJoinEnrollmentDialog(page)
}

/** Send a join request against a stubbed GitHub repo (local e2e). */
export async function sendJoinRequestLocalE2e(
  page: Page,
  stub: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  await page.getByTestId('join-enrollment-confirm').click()
  await waitForVaultOperationsIdle(page)
  await waitForStorageChainIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)

  await expect
    .poll(() => joinCountFromYaml(stub.getVaultYaml()), {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    .toBeGreaterThanOrEqual(1)

  const snapshot = parseVaultYamlSnapshot(stub.getVaultYaml())
  assertJoinPendingYaml(snapshot)
  const join = snapshot.joinEntries[0]!

  await expect(page.getByTestId('join-enrollment-dialog')).toContainText(
    'Waiting for approval',
    { timeout: UI_TIMEOUT_MS },
  )
  await page.getByTestId('join-enrollment-dismiss').click()
  await expect(page.getByTestId('join-enrollment-dialog')).not.toBeVisible()

  return join
}

export async function approveJoinLocalE2eFromBanner(
  page: Page,
  deviceId: string,
  stub: ReturnType<typeof createLocalE2eGithubVaultStub>,
  expectedMembers: number,
) {
  await waitForPendingJoinOnDevice(page, deviceId)
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })
  await row.getByTestId('approve-join-btn').click()
  await expect
    .poll(
      () => parseVaultYamlSnapshot(stub.getVaultYaml()).memberPkIds.length,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(expectedMembers)
  await expect
    .poll(() => parseVaultYamlSnapshot(stub.getVaultYaml()).joinEntries.length)
    .toBe(0)
  await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
}

/** Seed a GitHub sync provider, reload, unlock, and wait for status bar sync count. */
export async function reloadUnlockWithGithubSync(
  page: Page,
  opts?: {
    password?: string
    entryLabel?: string
    providers?: Array<{
      id: string
      label: string
      githubRepo: string
      githubPat: string
    }>
  },
) {
  const providers = opts?.providers ?? [E2E_GITHUB_ONBOARD_PROVIDER]
  await seedExtraGithubProviders(page, providers)

  const vaultYaml = await readLocalVaultYamlFromIdb(page)
  if (vaultYaml.trim()) {
    for (const provider of providers) {
      await stubGithubVaultForLocalE2e(page, {
        repoName: provider.githubRepo,
        vaultYaml,
      })
    }
  }

  await page.reload()

  if (vaultYaml.trim()) {
    for (const provider of providers) {
      await stubGithubVaultForLocalE2e(page, {
        repoName: provider.githubRepo,
        vaultYaml,
      })
    }
  }

  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await unlockVaultOnLogin(
    page,
    opts?.password
      ? { password: opts.password, entryLabel: opts.entryLabel }
      : undefined,
  )
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await disableVaultIdleLock(page)
  await dismissSyncConflictIfVisible(page)
  await waitForVaultOperationsIdle(page)
  await forceVaultQuiescentForE2e(page)
  await waitForLoadedSyncProviders(page)
  await waitForVaultSyncIdle(page)
}

/** Wait until the status bar reflects loaded sync providers. */
export async function waitForLoadedSyncProviders(
  page: Page,
  minCount = 1,
  timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS,
) {
  const pattern =
    minCount === 1
      ? /1 sync provider/
      : new RegExp(`${minCount} sync providers`)
  await expect(page.getByTestId('vault-sync-out-status')).toContainText(
    pattern,
    {
      timeout: timeoutMs,
    },
  )
}

async function syncSecretCount(target: GithubE2eTarget): Promise<number> {
  if (target.stub) {
    const yaml = target.stub.getVaultYaml()
    return yaml.trim() ? parseVaultYamlSnapshot(yaml).secretIds.length : 0
  }
  const yaml = await fetchGithubVaultYaml(target.pat, target.repoName)
  return parseVaultYamlSnapshot(yaml ?? 'secrets: []').secretIds.length
}

export async function addSecret(
  page: Page,
  key: string,
  value: string,
  github?: GithubE2eTarget,
) {
  const beforeCount = github ? await syncSecretCount(github) : 0
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  await page.getByTestId('add-secret-btn').click()
  await expect(page.getByTestId('add-secret-panel')).toBeVisible()
  await page.getByTestId('item-type-api-key').click()
  await page.getByTestId('secret-label').fill(key)
  await page.getByTestId('secret-value').fill(value)
  await page.getByTestId('save-secret-btn').click()
  await waitForVaultOperationsIdle(page)
  await assertNoVaultError(page)
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await expect(row).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  if (github) {
    await waitForStorageChainIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)
    await waitForGithubVaultState(
      github,
      (yaml) => yaml.secretIds.length > beforeCount,
      { page, timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
  }
}

export async function expandSecretRow(page: Page, key: string) {
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  const toggle = row.getByTestId('secret-row-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
}

export async function revealSecretValue(page: Page, key: string) {
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await revealSecretInRow(row)
  const grid = row.getByTestId('seed-phrase-grid')
  if (await grid.isVisible()) {
    const words = await row.getByTestId(/^seed-word-\d+$/).allTextContents()
    return words
      .map((word) => word.trim())
      .filter(Boolean)
      .join(' ')
  }
  const code = row.locator('code')
  await expect(code).toBeVisible()
  return (await code.textContent()) ?? ''
}

export async function waitForSecretOnDevice(
  page: Page,
  key: string,
  github?: GithubE2eTarget,
) {
  if (github) {
    await waitForGithubVaultState(github, (yaml) => yaml.secretIds.length > 0)
  }
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  const timeout = github ? configuredGithubSyncTimeoutMs() : UI_TIMEOUT_MS

  await expect
    .poll(
      async () => {
        if (await row.isVisible()) return true
        await page.evaluate(async () => {
          const vault = (
            window as Window & {
              __nookVault?: {
                syncFromStorage?: (opts?: { force?: boolean }) => Promise<void>
              }
            }
          ).__nookVault
          await vault?.syncFromStorage?.({ force: true })
        })
        await waitForVaultOperationsIdle(page)
        return row.isVisible()
      },
      { timeout },
    )
    .toBe(true)
}

export async function deleteSecret(
  page: Page,
  key: string,
  github?: GithubE2eTarget,
) {
  const beforeCount = github ? await syncSecretCount(github) : 0
  await waitForSecretOnDevice(page, key, github)
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
  const deleteBtn = row.getByRole('button', { name: 'Delete item' })
  await expect(deleteBtn).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await deleteBtn.click()
  await expect(row).toHaveCount(0, { timeout: UI_TIMEOUT_MS })
  if (github) {
    await waitForGithubVaultState(
      github,
      (yaml) => yaml.secretIds.length < beforeCount,
      { page },
    )
  }
}

export async function assertGenesisVaultOnGithub(
  target: GithubE2eTarget | string,
  repoName?: string,
) {
  const resolved: GithubE2eTarget =
    typeof target === 'string' ? { pat: target, repoName: repoName! } : target
  const snapshot = await waitForGithubVaultState(
    resolved,
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
  )
  assertGenesisVaultYaml(snapshot)
  return snapshot
}

export async function assertEnrolledVaultOnGithub(
  target: GithubE2eTarget | string,
  repoNameOrMembers?: string | number,
  expectedMembers?: number,
  page?: Page,
) {
  const resolved: GithubE2eTarget =
    typeof target === 'string'
      ? { pat: target, repoName: repoNameOrMembers as string }
      : target
  const members =
    typeof target === 'string'
      ? (expectedMembers as number)
      : (repoNameOrMembers as number)
  const snapshot = await waitForGithubVaultState(
    resolved,
    (yaml) =>
      yaml.joinEntries.length === 0 &&
      yaml.authPkIds.length === members &&
      yaml.memberPkIds.length === members,
    { page },
  )
  assertEnrolledVaultYaml(snapshot, members)
  return snapshot
}
