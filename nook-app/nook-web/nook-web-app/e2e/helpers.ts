import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertEnrolledVaultYaml,
  assertGenesisVaultYaml,
  assertJoinPendingYaml,
  joinCountFromYaml,
  parseVaultEventLogSnapshot,
  waitForVaultEventLogSnapshot,
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
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'
import { installMockPasskeyRuntime } from './passkey-mock'

const APP_LOGS_SCHEMA = 'nook.app-logs.v1' as const
const APP_LOGS_ATTACHMENT_LIMIT = 5000
const APP_LOGS_FAILURE_PRINT_LIMIT = 500

function buildAppLogsUrl(options?: {
  minLevel?: string
  limit?: number
  offset?: number
}): string {
  const params = new URLSearchParams()
  if (options?.minLevel) params.set('minLevel', options.minLevel)
  if (options?.limit !== undefined) params.set('limit', String(options.limit))
  if (options?.offset !== undefined)
    params.set('offset', String(options.offset))
  const qs = params.toString()
  return qs ? `/app-logs?${qs}` : '/app-logs'
}

type AppLogsResponse = {
  meta: {
    schema: typeof APP_LOGS_SCHEMA
    generatedAt: string
    activeLevel: string
    minLevel: string
    limit: number
    offset: number
    returned: number
    total: number
  }
  entries: NookLogEntry[]
}

type E2eOauthFileStub =
  | ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  | ReturnType<typeof createLocalE2eFileSyncVaultStub>

export {
  cleanupAllRegisteredE2eGithubRepos,
  cleanupE2eGithubRepo,
} from './github-repos'
export { createLocalE2eGoogleDriveVaultStub } from './drive-stub'

dotenv.config({
  path: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../.env.test.local',
  ),
})

export const githubPat = process.env.NOOK_GITHUB_PAT?.trim() ?? ''
/** Legacy default for docs; GitHub e2e suites use {@link createE2eGithubRepoName}. */
export const DEFAULT_GITHUB_REPO = 'nook'

let cachedE2eGithubRepoName: string | undefined = undefined

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

export async function openLoginProviderSetup(page: Page) {
  if (await page.getByTestId('provider-picker-list').isVisible()) {
    return
  }

  const connectBtn = page.getByTestId('login-connect-storage-btn')
  const legacyLink = page.getByTestId('login-use-storage-provider-link')
  const addBtn = page.getByTestId('add-provider-btn')
  const providerSetup = page.getByTestId('login-provider-setup')
  const providerEntryPoint = connectBtn
    .or(legacyLink)
    .or(addBtn)
    .or(providerSetup)
    .or(page.getByTestId('provider-picker-list'))

  await expect(providerEntryPoint.first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  if (await page.getByTestId('provider-picker-list').isVisible()) {
    return
  }

  if (await providerSetup.isVisible()) {
    await expect(page.getByTestId('provider-picker-list')).toBeVisible({
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

  await expect(page.getByTestId('provider-picker-list')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

export async function createLocalVaultOnLogin(
  page: Page,
  vaultName = 'Test vault',
  readyTestId = 'vault-panel',
) {
  const chooser = page.getByTestId('login-create-vault-chooser')
  await expect(chooser).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  const finalStep = page.getByTestId('create-vault-wizard-create')
  if (!(await finalStep.isVisible())) {
    const simplePath = page.getByTestId('get-started-path-simple')
    await expect(simplePath).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await simplePath.click()
    await expect(finalStep).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  }

  const nameInput = page.getByTestId('login-vault-name-input')
  await expect(nameInput).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(nameInput).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await nameInput.fill(vaultName, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  const createButton = page.getByTestId('login-create-device-vault-btn')
  await expect(createButton).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await createButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })

  // Deferred passkey: empty create may show the top-right overlay first.
  const passkeyOverlay = page.getByTestId('passkey-auth-overlay')
  const readySurface = page.getByTestId(readyTestId)
  await expect
    .poll(
      async () =>
        (await passkeyOverlay.isVisible()) || (await readySurface.isVisible()),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  if (await passkeyOverlay.isVisible()) {
    const createChoice = page.getByTestId('device-protection-create-new-choice')
    if (await createChoice.isVisible()) {
      await createChoice.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    }
    const setupBtn = page.getByTestId('device-protection-setup-btn')
    const unlockBtn = page.getByTestId('device-protection-unlock-btn')
    if (await setupBtn.isVisible()) {
      await setupBtn.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    } else if (await unlockBtn.isVisible()) {
      await unlockBtn.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    }
  }

  await expect(readySurface).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await disableVaultIdleLock(page)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            !(
              window as Window & {
                __nookVault?: { isVerifying?: boolean }
              }
            ).__nookVault?.isVerifying,
        ),
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await waitForStorageChainIdle(page)
  await disableVaultIdleLock(page)
}

export async function connectLocalVault(page: Page) {
  await page.goto('/app/')
  await expect(
    page.getByTestId('vault-panel').or(page.getByTestId('login-gate')),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })

  if (await page.getByTestId('vault-panel').isVisible()) {
    await disableVaultIdleLock(page)
    return
  }

  const chooser = page.getByTestId('login-create-vault-chooser')
  if (await chooser.isVisible()) {
    await createLocalVaultOnLogin(page)
    await disableVaultIdleLock(page)
    return
  }

  await unlockVaultOnLogin(page)
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
    timeoutMs: options?.timeoutMs ?? ENROLLMENT_UNLOCK_TIMEOUT_MS,
    intervalMs: options?.intervalMs ?? 100,
  })
}

async function flushRemoteEventsToSyncProviders(page: Page) {
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
        const onError = (err: DOMException | undefined) =>
          reject(err ?? new Error('IndexedDB delete failed'))

        const vaultDb = indexedDB.deleteDatabase('nook_db')
        vaultDb.onsuccess = done
        vaultDb.onerror = () => onError(vaultDb.error ?? undefined)
        vaultDb.onblocked = done

        const authDb = indexedDB.deleteDatabase('nook_auth')
        authDb.onsuccess = done
        authDb.onerror = () => onError(authDb.error ?? undefined)
        authDb.onblocked = done
      }),
  )
}

export async function createIsolatedContext(
  browser: Browser,
): Promise<BrowserContext> {
  const context = await browser.newContext()
  await context.addInitScript(installMockPasskeyRuntime)
  return context
}

export async function installPasskeyMock(page: Page): Promise<void> {
  await page.addInitScript(installMockPasskeyRuntime)
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
          syncingProviderId?: string | undefined
          isPasswordBusy?: boolean
        }
      }
    ).__nookVault
    if (!vault) return
    vault.stopVaultSync?.()
    vault.isSyncing = false
    vault.isFanOutSyncing = false
    vault.syncingProviderId = undefined
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
          syncingProviderId?: string | undefined
          isPasswordBusy?: boolean
        }
      }
    ).__nookVault
    if (!vault) return
    vault.stopVaultSync?.()
    vault.stopIdleSessionTracking?.()
    vault.isSyncing = false
    vault.isFanOutSyncing = false
    vault.syncingProviderId = undefined
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
  // Sync UI flags can be reasserted by an already queued timer after it is
  // stopped. The storage chain below is the authoritative persistence gate;
  // only unlock/save/password work must block this poll.
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
  await expect(button.first()).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(button.first()).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(button.first()).not.toContainText('Loading engine', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  return button.first()
}

async function assertGithubConnected(page: Page) {
  await assertNoVaultErrors(page, { allowTransient: true })
  if (!(await page.getByTestId('vault-panel').isVisible())) {
    await page.getByTestId('vault-secrets-tab').click()
  }
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await keepVaultIdleLockDisabled(page)
}

async function setupGithubProvider(page: Page, pat: string, repoName: string) {
  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-github').click()
  await page.getByTestId('github-repo-input').fill(repoName)
  await page.getByTestId('github-pat-input').fill(pat)
}

async function readGoogleOAuthError(page: Page): Promise<string | undefined> {
  const error = page.getByTestId('google-oauth-error')
  if (!(await error.isVisible())) {
    return undefined
  }
  return ((await error.textContent()) ?? undefined)?.trim() || undefined
}

async function waitForGoogleOAuthSignedIn(page: Page) {
  await expect
    .poll(
      async () => {
        const errorText = await readGoogleOAuthError(page)
        if (errorText) {
          throw new Error(`Google OAuth failed: ${errorText}`)
        }
        return (
          (await page.getByTestId('google-account-status').isVisible()) ||
          (await page.getByTestId('connect-provider-btn').isVisible())
        )
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
}

async function setupGoogleDriveProvider(page: Page, fileName: string) {
  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-oauth-file').click()
  await expect(page.getByTestId('google-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('drive-file-input').fill(fileName)
  await page.getByTestId('google-sign-in-btn').click()
  await waitForGoogleOAuthSignedIn(page)
}

function installGoogleTokenClient(token: string) {
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          callback: (response: {
            access_token: string
            expires_in: number
          }) => void
        }) => ({
          requestAccessToken: () => {
            config.callback({ access_token: token, expires_in: 3600 })
          },
        }),
      },
    },
  }
}

/** Mock Google Identity Services token client for e2e (call before navigation). */
export async function installGoogleOAuthMock(
  page: Page,
  accessToken = 'ya29.e2e_stub_access_token',
) {
  const gisMockBody = `window.google=window.google||{};window.google.accounts=window.google.accounts||{};window.google.accounts.oauth2={initTokenClient:function(config){return{requestAccessToken:function(){config.callback({access_token:${JSON.stringify(accessToken)},expires_in:3600})}}}};`

  await page.addInitScript(installGoogleTokenClient, accessToken)
  await page.route('https://accounts.google.com/gsi/client', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: gisMockBody,
    })
  })
  await page.route(
    'https://www.googleapis.com/drive/v3/about**',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { emailAddress: 'e2e-user@example.com' },
        }),
      })
    },
  )
  await page.evaluate(installGoogleTokenClient, accessToken)
}

export async function waitForVaultUnlocked(
  page: Page,
  timeout = UI_TIMEOUT_MS,
) {
  try {
    await expect(page.getByTestId('vault-panel')).toBeVisible({ timeout })
  } catch (error) {
    const errorText = (
      await page
        .getByTestId('vault-error')
        .or(page.getByTestId('onboard-error'))
        .or(page.getByTestId('vault-password-error'))
        .allTextContents()
    )
      .map((text) => text.trim())
      .filter(Boolean)
      .join(' | ')
    throw new Error(
      errorText
        ? `Vault did not unlock. Visible error: ${errorText}`
        : `Vault did not unlock: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export async function wipeDeviceIdentity(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () =>
          reject(request.error ?? new Error('idb open failed'))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('vault', 'readwrite')
          const store = tx.objectStore('vault')
          store.delete('device_id')
          store.delete('device_identity_wrapped')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'))
        }
      }),
  )
}

export async function expectEmptyLocalFolderRejected(
  page: Page,
  afterSetup: () => Promise<void> = async () => undefined,
): Promise<void> {
  await page.getByTestId('login-connect-storage-btn').click()
  await expect(page.getByTestId('login-provider-setup')).toBeVisible()
  await afterSetup()
  await page.getByTestId('provider-option-local-folder').click()
  await page.getByTestId('login-choose-local-folder-btn').click()
  await expect(page.getByTestId('login-local-folder-selected')).toHaveText(
    'Nook Backup',
  )
  await page.getByTestId('login-connect-local-folder-btn').click()
  await expect(page.getByTestId('vault-error')).toContainText(
    'No existing vault was found in this provider',
  )
  await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
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
  await page.goto('/app/')
  await createLocalVaultOnLogin(page)
  await connectGithubSyncProviderFromSettings(page, repoName, pat)
  if (stub) {
    await expect
      .poll(
        () => {
          if (stub.getEventFileCount() > 0) return 'event-log'
          const yaml = stub.getVaultYaml()
          if (!yaml.trim()) return 'waiting'
          try {
            const snapshot = parseVaultYamlSnapshot(yaml)
            return snapshot.authPkIds.length >= 1 &&
              snapshot.memberPkIds.length >= 1
              ? 'vault-yaml'
              : 'waiting'
          } catch {
            return 'waiting'
          }
        },
        { timeout: GITHUB_CONNECT_TIMEOUT_MS },
      )
      .not.toBe('waiting')
  } else {
    await waitForGithubVaultState(
      target,
      (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
      { page, timeoutMs: GITHUB_CONNECT_TIMEOUT_MS },
    )
  }
  await assertGithubConnected(page)
}

export async function connectGoogleDriveVault(
  page: Page,
  accessToken: string,
  fileName: string,
  stub?: E2eOauthFileStub,
) {
  await installGoogleOAuthMock(page, accessToken)
  if (stub) {
    await stub.install(page, { fileName })
  }
  await page.goto('/app/')
  await createLocalVaultOnLogin(page)
  await connectGoogleDriveSyncProviderFromSettings(page, fileName, accessToken)
  await waitForSyncRemoteVaultState(
    stub ?? createLocalE2eGoogleDriveVaultStub('', fileName),
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
    { page, timeoutMs: GITHUB_CONNECT_TIMEOUT_MS },
  )
  await assertGithubConnected(page)
}

export async function connectGoogleDriveGenesisDevice(
  page: Page,
  accessToken: string,
  fileName: string,
  stub?: E2eOauthFileStub,
) {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectGoogleDriveVault(page, accessToken, fileName, stub)
}

/** Genesis device: fresh browser + GitHub repo → connected vault. */
export async function connectGithubGenesisDevice(
  page: Page,
  pat: string,
  repoName: string,
  stub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  await page.goto('/app/')
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
  await page.goto('/app/')
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

type JoinerVaultReadyTarget = {
  pat: string
  repoName: string
  providerId?: string
  stub?: {
    install: (page: Page, opts: Record<string, unknown>) => Promise<void>
  }
}

function isOauthFileJoinerTarget(target: JoinerVaultReadyTarget) {
  return (
    target.providerId === 'file' ||
    target.providerId === 'local' ||
    target.providerId === 'google-drive'
  )
}

async function tryGithubVaultConnect(
  page: Page,
  target: JoinerVaultReadyTarget,
) {
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

async function tryOauthFileVaultConnect(
  page: Page,
  target: JoinerVaultReadyTarget,
) {
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

  await installGoogleOAuthMock(page, target.pat)
  await setupGoogleDriveProvider(page, target.repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForVaultOperationsIdle(page)
}

async function tryJoinerVaultConnect(
  page: Page,
  target: JoinerVaultReadyTarget,
) {
  if (isOauthFileJoinerTarget(target)) {
    await tryOauthFileVaultConnect(page, target)
    return
  }
  await tryGithubVaultConnect(page, target)
}

/**
 * Keep the e2e idle lock (2.5s) suppressed across unlocks.
 *
 * `disableVaultIdleLock` only stops the *current* tracker; every
 * `markVaultUnlocked()` starts a new one. While a helper is driving connect
 * attempts, the vault can unlock and idle-lock again between two Playwright
 * calls, so pin an interval in the page that keeps stopping the tracker.
 */
export async function keepVaultIdleLockDisabled(page: Page) {
  await page.evaluate(() => {
    const w = window as Window & {
      __nookVault?: { stopIdleSessionTracking?: () => void }
      __nookE2eIdleGuard?: number
    }
    if (w.__nookE2eIdleGuard) return
    w.__nookE2eIdleGuard = window.setInterval(() => {
      w.__nookVault?.stopIdleSessionTracking?.()
    }, 300)
  })
}

export async function waitForJoinerVaultReady(
  page: Page,
  target: JoinerVaultReadyTarget,
) {
  if (target.stub) {
    await target.stub.install(
      page,
      isOauthFileJoinerTarget(target)
        ? { fileName: target.repoName }
        : { repoName: target.repoName },
    )
  }
  if (isOauthFileJoinerTarget(target)) {
    await installGoogleOAuthMock(page, target.pat)
  }
  await keepVaultIdleLockDisabled(page)
  try {
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
          await tryJoinerVaultConnect(page, target)
          return (
            (await page.getByTestId('vault-panel').isVisible()) ||
            (await page.getByTestId('secret-row').count()) > 0
          )
        },
        { timeout: GITHUB_CONNECT_TIMEOUT_MS },
      )
      .toBe(true)
  } catch (error) {
    await dumpNookLogs(page, 'waitForJoinerVaultReady')
    throw error
  }
  await disableVaultIdleLock(page)
}

type NookLogEntry = {
  ts: string
  level: string
  scope: string
  message: string
  data?: string
}

/** Read persisted app log entries (`window.__nookLog`) from the page, or undefined. */
async function readNookLogEntries(
  page: Page,
  limit: number,
): Promise<NookLogEntry[] | undefined> {
  return page.evaluate(async (lim) => {
    const log = (
      window as Window & {
        __nookLog?: {
          dump: (opts?: { limit?: number }) => Promise<
            {
              ts: string
              level: string
              scope: string
              message: string
              data?: string
            }[]
          >
        }
      }
    ).__nookLog
    if (!log) return undefined
    return log.dump({ limit: lim })
  }, limit)
}

async function readNookLogSnapshot(
  page: Page,
  options?: { minLevel?: string; limit?: number; offset?: number },
): Promise<AppLogsResponse | undefined> {
  const query = {
    schema: APP_LOGS_SCHEMA,
    minLevel: options?.minLevel ?? 'trace',
    limit: options?.limit ?? APP_LOGS_ATTACHMENT_LIMIT,
    offset: options?.offset ?? 0,
  }
  return page.evaluate(async (opts) => {
    const log = (
      window as Window & {
        __nookLog?: {
          flush: () => Promise<void>
          getLevel: () => string
          count: () => Promise<number>
          dump: (opts?: {
            minLevel?: string
            limit?: number
            offset?: number
          }) => Promise<
            {
              ts: string
              level: string
              scope: string
              message: string
              data?: string
            }[]
          >
        }
      }
    ).__nookLog
    if (!log) return undefined
    await log.flush()
    const [total, entries] = await Promise.all([
      log.count(),
      log.dump({
        minLevel: opts.minLevel,
        limit: opts.limit,
        offset: opts.offset,
      }),
    ])
    return {
      meta: {
        schema: opts.schema,
        generatedAt: new Date().toISOString(),
        activeLevel: log.getLevel(),
        minLevel: opts.minLevel,
        limit: opts.limit,
        offset: opts.offset,
        returned: entries.length,
        total,
      },
      entries,
    }
  }, query)
}

function printNookLogEntries(label: string, entries: NookLogEntry[]) {
  console.log(`[${label}] last ${entries.length} app log entries:`)
  for (const entry of entries) {
    const data = entry.data ? ` ${entry.data}` : ''
    console.log(
      `  ${entry.ts} ${entry.level.toUpperCase()} [${entry.scope}] ${entry.message}${data}`,
    )
  }
}

/**
 * Fetch persisted app logs via the `/app-logs` JSON export route.
 * Prefer this over ad-hoc `page.evaluate` when debugging e2e failures.
 */
export async function fetchAppLogs(
  page: Page,
  options?: {
    minLevel?: string
    limit?: number
    offset?: number
  },
): Promise<AppLogsResponse> {
  const url = buildAppLogsUrl(options)
  await page.goto(url)
  const json = page.getByTestId('app-logs-json')
  await expect(json).toBeVisible({ timeout: UI_TIMEOUT_MS })
  const text = await json.textContent()
  if (!text) {
    throw new Error('`/app-logs` returned an empty JSON body')
  }
  const payload = JSON.parse(text) as AppLogsResponse
  if (payload.meta?.schema !== APP_LOGS_SCHEMA) {
    throw new Error(
      `Unexpected /app-logs schema: ${String(payload.meta?.schema)}`,
    )
  }
  return payload
}

/** Read persisted app log entries (`window.__nookLog`) from the page, or undefined. */
export async function readPersistedAppLogs(
  page: Page,
  limit = 500,
): Promise<NookLogEntry[] | undefined> {
  return readNookLogEntries(page, limit)
}

/** Drain the in-memory log queue into IndexedDB before reading `/logs` or `/app-logs`. */
export async function flushNookLogPersistQueue(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const log = (
      window as Window & { __nookLog?: { flush: () => Promise<void> } }
    ).__nookLog
    await log?.flush()
  })
}

export async function waitForPersistedAppLog(
  page: Page,
  filter: {
    scope?: string
    level?: string
    messageIncludes?: string
  },
  options?: { limit?: number; timeoutMs?: number },
): Promise<NookLogEntry> {
  let found: NookLogEntry | undefined
  await expect
    .poll(
      async () => {
        await flushNookLogPersistQueue(page)
        const entries = await readNookLogEntries(page, options?.limit ?? 500)
        found = findAppLogEntry(entries ?? [], filter)
        return found ?? undefined
      },
      { timeout: options?.timeoutMs ?? UI_TIMEOUT_MS * 2 },
    )
    .not.toBeUndefined()
  return found!
}

/** Wait for each persisted log milestone in order (see `.cortex/references/logging.md`). */
export async function expectAppLogMilestones(
  page: Page,
  milestones: Array<{
    scope?: string
    level?: string
    messageIncludes: string
  }>,
  options?: { limit?: number; timeoutMs?: number },
): Promise<void> {
  let lastEntries: NookLogEntry[] = []
  await expect
    .poll(
      async () => {
        await flushNookLogPersistQueue(page)
        lastEntries =
          (await readNookLogEntries(page, options?.limit ?? 500)) ?? []
        return appLogMilestonesAreInOrder(lastEntries, milestones)
      },
      { timeout: options?.timeoutMs ?? UI_TIMEOUT_MS * 2 },
    )
    .toBe(true)

  expect(
    appLogMilestonesAreInOrder(lastEntries, milestones),
    `expected app log milestones in order: ${JSON.stringify(milestones)}`,
  ).toBe(true)
}

export function findAppLogEntry(
  entries: NookLogEntry[],
  filter: {
    scope?: string
    level?: string
    messageIncludes?: string
  },
): NookLogEntry | undefined {
  return entries.find((entry) => {
    if (filter.scope && entry.scope !== filter.scope) return false
    if (filter.level && entry.level !== filter.level) return false
    if (
      filter.messageIncludes &&
      !entry.message.includes(filter.messageIncludes)
    ) {
      return false
    }
    return true
  })
}

function appLogEntryMatches(
  entry: NookLogEntry,
  filter: {
    scope?: string
    level?: string
    messageIncludes?: string
  },
): boolean {
  if (filter.scope && entry.scope !== filter.scope) return false
  if (filter.level && entry.level !== filter.level) return false
  if (
    filter.messageIncludes &&
    !entry.message.includes(filter.messageIncludes)
  ) {
    return false
  }
  return true
}

function appLogMilestonesAreInOrder(
  entries: NookLogEntry[],
  milestones: Array<{
    scope?: string
    level?: string
    messageIncludes: string
  }>,
): boolean {
  let start = 0
  for (const milestone of milestones) {
    const index = entries.findIndex(
      (entry, offset) =>
        offset >= start && appLogEntryMatches(entry, milestone),
    )
    if (index === -1) return false
    start = index + 1
  }
  return true
}

export function expectAppLogEntry(
  entries: NookLogEntry[],
  filter: {
    scope?: string
    level?: string
    messageIncludes?: string
  },
): NookLogEntry {
  const entry = findAppLogEntry(entries, filter)
  expect(
    entry,
    `expected app log matching ${JSON.stringify(filter)}; got scopes: ${[
      ...new Set(entries.map((e) => e.scope)),
    ].join(', ')}`,
  ).toBeDefined()
  return entry!
}

function parseLogsPageStoredCount(text: string | undefined): number {
  const match = text?.match(/(\d+) stored/)
  return match ? Number(match[1]) : 0
}

/** Wait until `/logs` shows a stored count matching `predicate` (WASM may init late). */
export async function waitForLogsPageStoredCount(
  page: Page,
  predicate: (count: number) => boolean,
  options?: { timeoutMs?: number },
): Promise<number> {
  let count = 0
  await expect
    .poll(
      async () => {
        await page.getByTestId('logs-refresh-btn').click()
        count = parseLogsPageStoredCount(
          (await page.getByTestId('logs-count').textContent()) ?? undefined,
        )
        return predicate(count) ? count : undefined
      },
      { timeout: options?.timeoutMs ?? UI_TIMEOUT_MS * 2 },
    )
    .not.toBeUndefined()
  return count
}

export async function expectLogsPageHasEntries(page: Page): Promise<void> {
  await expect(page.getByTestId('logs-page')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await waitForLogsPageStoredCount(page, (stored) => stored > 0)
  await expect(page.getByTestId('logs-entry').first()).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

/**
 * Print the app's persisted IndexedDB debug log (`window.__nookLog`) to the
 * test output. The WASM logger persists everything at or above the active
 * level, so lower the level (e.g. `VITE_LOG_LEVEL=debug`) to capture more.
 */
export async function dumpNookLogs(
  page: Page,
  label = 'nook-logs',
  options?: { limit?: number },
) {
  try {
    const entries = await readNookLogEntries(page, options?.limit ?? 200)
    if (!entries) {
      console.warn(`[${label}] __nookLog is not available on the page`)
      return
    }
    printNookLogEntries(label, entries)
  } catch (error) {
    console.warn(
      `[${label}] failed to dump app logs:`,
      error instanceof Error ? error.message : error,
    )
  }
}

/**
 * Attach a canonical `/app-logs`-style JSON payload to a Playwright test result.
 * Prints the same entries only when requested by the caller. Wired globally via
 * the {@link file://./fixtures.ts} auto fixture — no per-spec `afterEach` needed.
 * Never throws.
 */
export async function attachNookLogsForTest(
  page: Page,
  testInfo: import('@playwright/test').TestInfo,
  options?: { print?: boolean },
) {
  try {
    const payload = await readNookLogSnapshot(page, {
      minLevel: 'trace',
      limit: APP_LOGS_ATTACHMENT_LIMIT,
      offset: 0,
    })
    if (!payload) return
    if (options?.print && payload.entries.length > 0) {
      printNookLogEntries(
        `nook-logs] [${testInfo.title}`,
        payload.entries.slice(-APP_LOGS_FAILURE_PRINT_LIMIT),
      )
    }
    const body = JSON.stringify(payload, undefined, 2)
    const attachmentPath = testInfo.outputPath('nook-app-logs.json')
    await fs.writeFile(attachmentPath, body)
    await testInfo.attach('nook-app-logs.json', {
      path: attachmentPath,
      contentType: 'application/json',
    })
  } catch {
    // Post-mortem logging must never fail the run.
  }
}

/** Expand the login enrollment accordion on the login gate. */
export async function expandLoginEnrollmentPanel(page: Page) {
  const toggle = page.getByTestId('login-enrollment-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
}

/** Open the admin surface that owns sync providers and passwords. */
export async function openStorageSettings(page: Page) {
  await keepVaultIdleLockDisabled(page)
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  const adminTab = page.getByTestId('vault-admin-tab')
  await expect
    .poll(
      async () => {
        try {
          await expect(adminTab).toBeVisible({ timeout: UI_TIMEOUT_MS })
          await expect(adminTab).toBeEnabled({ timeout: UI_TIMEOUT_MS })
          await adminTab.click({ timeout: UI_TIMEOUT_MS })
          return await page.getByTestId('vault-admin-panel').isVisible()
        } catch {
          return false
        }
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(true)
  await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('vault-panel')).not.toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

/** Add and connect a GitHub sync provider from vault settings (vault must be unlocked). */
export async function connectGithubSyncProviderFromSettings(
  page: Page,
  repoName: string,
  pat = 'ghp_test_token',
  options?: { expectConflict?: boolean },
) {
  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await page.getByTestId('add-provider-btn').first().click()
  await page.getByTestId('provider-option-github').click()
  await expect(page.getByTestId('github-token-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('github-repo-input').fill(repoName)
  await page.getByTestId('github-pat-input').fill(pat)
  await page.getByTestId('connect-provider-btn').click()
  await waitForVaultOperationsIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)
  if (!options?.expectConflict) {
    await expect(
      page.getByTestId('vault-sync-conflict-dialog'),
    ).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
  }
}

const SETTINGS_SECTION_TEST_IDS = {
  storage: 'storage-providers-section',
  unlock: 'vault-unlock-section',
  import: 'vault-import-export-section',
  devices: 'vault-devices-section',
} as const

export type SettingsSection = keyof typeof SETTINGS_SECTION_TEST_IDS

/** Expand one vault settings accordion section (only one open at a time). */
export async function expandSettingsSection(
  page: Page,
  section: SettingsSection,
) {
  const targetTab =
    section === 'devices'
      ? page.getByTestId('vault-settings-tab')
      : page.getByTestId('vault-admin-tab')
  const targetPanel =
    section === 'devices'
      ? page.getByTestId('storage-settings-panel')
      : page.getByTestId('vault-admin-panel')
  if (!(await targetPanel.isVisible())) {
    await targetTab.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(targetPanel).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  }
  const sectionEl = page.getByTestId(SETTINGS_SECTION_TEST_IDS[section])
  await expect(sectionEl).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  const toggle = sectionEl.getByRole('button').first()
  await expect(toggle).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  if (
    (await toggle.getAttribute('aria-expanded', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })) !== 'true'
  ) {
    await toggle.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
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
  const success = page.getByTestId('app-success')
  const error = page.getByTestId('vault-password-error')
  await expect(success.or(error)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await error.isVisible()) {
    throw new Error(`Password rotation failed: ${await error.innerText()}`)
  }
  await expect(success).toContainText(/password/i)
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
  // IndexedDB read via page.evaluate — small round-trip, still much cheaper than network.
  const intervalMs = options?.intervalMs ?? 150
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

/** Match the vault password badge copy. */
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

/** Issue an onboard enrollment code and return the onboarding link input locator. */
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
  const entryList = page.getByTestId('onboard-password-entry-list')
  if (await entryList.isVisible()) {
    await entryList.getByRole('radio').first().click()
  }
  await expect(page.getByTestId('onboard-device-submit')).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('onboard-password-input').fill(password)
  await page.getByTestId('onboard-device-submit').click()

  const linkInput = page.getByTestId('onboarding-link-url')
  const generating = page.getByTestId('onboard-generating')
  const error = page.getByTestId('onboard-error')
  await expect(linkInput.or(error).or(generating)).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  if (await error.isVisible()) {
    throw new Error(
      `Onboard enrollment failed: ${(await error.textContent())?.trim() ?? 'unknown error'}`,
    )
  }
  await expect(linkInput).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  return linkInput
}

/** Raw enrollment payload from a full onboarding URL or hash link. */
export function enrollmentCodeFromLink(link: string): string {
  const trimmed = link.trim()
  const hashIndex = trimmed.indexOf('#enroll=')
  if (hashIndex >= 0) {
    return decodeURIComponent(trimmed.slice(hashIndex + '#enroll='.length))
  }
  return trimmed
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
export async function reconnectSyncVault(page: Page) {
  await page.goto('/app/')
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

  await unlockVaultOnLogin(page)
  await expect
    .poll(async () => vaultReady(), {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    .toBe(true)
  await disableVaultIdleLock(page)
}

/** Add and connect a local sync provider from vault settings (vault must be unlocked). */
export async function connectGoogleDriveSyncProviderFromSettings(
  page: Page,
  fileName: string,
  accessToken = E2E_OAUTH_ONBOARD_PROVIDER.accessToken,
  options?: { expectConflict?: boolean },
) {
  await installGoogleOAuthMock(page, accessToken)
  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await page.getByTestId('add-provider-btn').first().click()
  await page.getByTestId('provider-option-oauth-file').click()
  await expect(page.getByTestId('google-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('drive-file-input').fill(fileName)
  await page.getByTestId('google-sign-in-btn').click()
  await waitForGoogleOAuthSignedIn(page)
  await page.getByTestId('connect-provider-btn').click()
  await waitForVaultOperationsIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)
  if (!options?.expectConflict) {
    await expect(
      page.getByTestId('vault-sync-conflict-dialog'),
    ).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
  }
}

export async function assertVaultReady(page: Page) {
  await expect(page.getByTestId('authenticated-shell')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

export async function revealSecretInRow(
  row: import('@playwright/test').Locator,
) {
  const toggle = row.getByTestId('secret-row-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  const revealButton = row.getByTestId('reveal-secret-btn')
  await expect(revealButton).toBeVisible({ timeout: UI_TIMEOUT_MS })
  if ((await revealButton.getAttribute('aria-pressed')) !== 'true') {
    await revealButton.click()
  }
  await expect(revealButton).toHaveAttribute('aria-pressed', 'true', {
    timeout: UI_TIMEOUT_MS,
  })
}

export async function selectLoginUnlockMethod(
  page: Page,
  method: 'keys' | 'password',
) {
  const button = page.getByTestId(`login-unlock-method-${method}`)
  await expect(button).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await button.click()
}

/** Authorize the wrapped device identity after an explicit or idle lock. */
export async function authorizeDeviceProtection(
  page: Page,
  opts?: { storeId?: string },
) {
  const overlay = page.getByTestId('passkey-auth-overlay')
  const vaultPanel = page.getByTestId('vault-panel')
  const button = page.getByTestId('device-protection-unlock-btn')
  if (!(await overlay.isVisible())) {
    const vaultPicker = page.getByTestId('login-vault-picker')
    if (await vaultPicker.isVisible()) {
      const option = opts?.storeId
        ? page.locator(
            `[data-testid="login-vault-option"][data-store-id="${opts.storeId}"]`,
          )
        : page.getByTestId('login-vault-option').first()
      await expect(option).toBeVisible({ timeout: UI_TIMEOUT_MS })
      await option.click()
    }
    const unlockVaultButton = page.getByTestId('unlock-vault-btn')
    await expect(unlockVaultButton).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await unlockVaultButton.click()
  }
  await expect
    .poll(
      async () => {
        if (await vaultPanel.isVisible()) return 'unlocked'
        if ((await button.isVisible()) && (await button.isEnabled())) {
          return 'authorize'
        }
        return 'waiting'
      },
      { timeout: UI_TIMEOUT_MS },
    )
    .not.toBe('waiting')
  if (await vaultPanel.isVisible()) {
    await waitForVaultOperationsIdle(page)
    return
  }
  await button.click()
  await expect(vaultPanel).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await waitForVaultOperationsIdle(page)
}

async function invokeVaultLoadProviders(page: Page) {
  await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: {
          isAuthenticated?: boolean
          loadProviders?: () => Promise<void>
        }
      }
    ).__nookVault
    if (vault?.isAuthenticated && vault.loadProviders) {
      await vault.loadProviders()
    }
  })
}

/** Wait until the login gate exposes local unlock or the vault is already open. */
async function ensureLoginLocalUnlockReady(page: Page) {
  const vaultPanel = page.getByTestId('vault-panel')
  if (await vaultPanel.isVisible()) {
    return
  }

  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  const localUnlock = page.getByTestId('login-local-unlock-step')
  const vaultPicker = page.getByTestId('login-vault-picker')

  await expect
    .poll(
      async () => {
        if (await vaultPanel.isVisible()) return 'ready'
        if (await localUnlock.isVisible()) return 'ready'
        if (await vaultPicker.isVisible()) return 'ready'
        await page.evaluate(async () => {
          const vault = (
            window as Window & {
              __nookVault?: {
                refreshLocalVaultCatalog?: () => Promise<void>
                prepareLocalLogin?: () => Promise<void>
              }
            }
          ).__nookVault
          await vault?.refreshLocalVaultCatalog?.()
          await vault?.prepareLocalLogin?.()
        })
        return 'waiting'
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe('ready')
}

/** Unlock from the login gate — optional password when device keys are unavailable. */
export async function unlockVaultOnLogin(
  page: Page,
  opts?: { password?: string; entryLabel?: string; storeId?: string },
) {
  if (await page.getByTestId('vault-panel').isVisible()) {
    return
  }
  await ensureLoginLocalUnlockReady(page)

  const vaultPicker = page.getByTestId('login-vault-picker')
  if (await vaultPicker.isVisible()) {
    const option = opts?.storeId
      ? page.locator(
          `[data-testid="login-vault-option"][data-store-id="${opts.storeId}"]`,
        )
      : page.getByTestId('login-vault-option').first()
    await expect(option).toBeVisible({ timeout: UI_TIMEOUT_MS })
    await option.click()
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  }

  const localUnlock = page.getByTestId('login-local-unlock-step')
  if (await localUnlock.isVisible()) {
    if (opts?.password) {
      await selectLoginUnlockMethod(page, 'password')
      await expect(
        page.getByTestId('login-password-entry-list').getByRole('button', {
          name: opts.entryLabel ?? /.+/,
        }),
      ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
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
    'Login gate has no local unlock step — use createLocalVaultOnLogin or openLoginProviderSetup.',
  )
}

/** Mark the browser session as explicitly locked so auto-unlock stays off after reload. */
export async function disableLoginAutoUnlock(page: Page) {
  await page.evaluate(() => {
    sessionStorage.setItem('nook_vault_session_locked', '1')
  })
}

/** @deprecated `disableLoginAutoUnlock` no longer adds a dummy provider. */
export async function removeE2eDummyGithubSyncProvider(page: Page) {
  await page.evaluate(() => undefined)
}

type SeededAuthProvider = {
  id: string
  type: string
  label: string
  githubRepo?: string
  githubPat?: string
  oauthFile?: {
    preset: string
    accessToken: string
    fileName: string
    accountEmail?: string
    folderId?: string
  }
  storeId?: string
  createdAt?: string
}

async function appendAuthProviders(
  page: Page,
  providers: SeededAuthProvider[],
  vaultStoreId?: string,
): Promise<void> {
  await page.evaluate(
    ({ providers: additions, vaultStoreId: fallbackStoreId }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onerror = () =>
          reject(request.error ?? new Error('idb open failed'))
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readwrite')
          const store = tx.objectStore('auth')
          const getRequest = store.get('providers')
          getRequest.onerror = () =>
            reject(getRequest.error ?? new Error('idb read failed'))
          getRequest.onsuccess = () => {
            const snapshot = (getRequest.result as
              | {
                  providers: SeededAuthProvider[]
                  activeVaultStoreId?: string
                }
              | undefined) ?? { providers: [] }
            const activeStoreId =
              snapshot.activeVaultStoreId?.trim() || fallbackStoreId
            snapshot.providers.push(
              ...additions.map((provider) => ({
                ...provider,
                storeId:
                  provider.type === 'oauth-file'
                    ? activeStoreId
                    : provider.storeId,
                createdAt: new Date().toISOString(),
              })),
            )
            const putRequest = store.put(snapshot, 'providers')
            putRequest.onerror = () =>
              reject(putRequest.error ?? new Error('idb write failed'))
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
        }
      }),
    { providers, vaultStoreId },
  )
}

async function waitForAuthProviderIds(
  page: Page,
  expectedIds: string[],
): Promise<void> {
  await page.waitForFunction(
    (ids) =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open('nook_auth', 1)
        request.onerror = () => resolve(false)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('auth', 'readonly')
          const getRequest = tx.objectStore('auth').get('providers')
          getRequest.onerror = () => resolve(false)
          getRequest.onsuccess = () => {
            const snapshot = getRequest.result as
              | { providers?: Array<{ id: string }> }
              | undefined
            const storedIds = new Set(
              snapshot?.providers?.map((provider) => provider.id) ?? [],
            )
            resolve(ids.every((id) => storedIds.has(id)))
          }
          tx.oncomplete = () => db.close()
        }
      }),
    expectedIds,
    { timeout: UI_TIMEOUT_MS },
  )
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
  await appendAuthProviders(
    page,
    extras.map((provider) => ({ ...provider, type: 'github' })),
  )
  await waitForAuthProviderIds(
    page,
    extras.map((provider) => provider.id),
  )
}

/**
 * Add extra oauth-file providers to the saved auth snapshot for onboarding UI tests.
 */
export async function seedExtraOauthFileProviders(
  page: Page,
  extras: Array<{
    id: string
    label: string
    fileName: string
    accessToken: string
    accountEmail?: string
    folderId?: string
  }>,
) {
  const vaultYaml = await readLocalVaultYamlFromIdb(page).catch(() => '')
  const storeIdFromVault = vaultYaml.match(/^store_id:\s*(\S+)/m)?.[1]

  await appendAuthProviders(
    page,
    extras.map((provider) => ({
      id: provider.id,
      type: 'oauth-file',
      label: provider.label,
      oauthFile: {
        preset: 'google-drive',
        accessToken: provider.accessToken,
        fileName: provider.fileName,
        accountEmail: provider.accountEmail,
        folderId: provider.folderId,
      },
    })),
    storeIdFromVault,
  )
  await waitForAuthProviderIds(
    page,
    extras.map((provider) => provider.id),
  )
}

const AGE_ARMOR_MARKER = 'BEGIN AGE ENCRYPTED FILE'

export type RawAuthProvidersSnapshot = {
  providers: Array<{
    id: string
    type: string
    githubPat?: string
    oauthFile?: {
      accessToken?: string
      refreshToken?: string
    }
  }>
}

/** Read the raw `nook_auth` snapshot as persisted (sealed credential fields). */
export async function readRawAuthProvidersFromIdb(
  page: Page,
): Promise<RawAuthProvidersSnapshot> {
  return page.evaluate(() => {
    return new Promise<RawAuthProvidersSnapshot>((resolve, reject) => {
      const request = indexedDB.open('nook_auth', 1)
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('auth', 'readonly')
        const store = tx.objectStore('auth')
        const getReq = store.get('providers')
        getReq.onerror = () =>
          reject(getReq.error ?? new Error('idb read failed'))
        getReq.onsuccess = () => {
          resolve(
            (getReq.result as RawAuthProvidersSnapshot | undefined) ?? {
              providers: [],
            },
          )
        }
        tx.oncomplete = () => db.close()
        tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
      }
    })
  })
}

export async function waitForAuthProvidersE2eHook(page: Page) {
  await page.waitForFunction(
    () =>
      !!(window as Window & { __nookAuthProviders?: unknown })
        .__nookAuthProviders,
    undefined,
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
}

/** Load decrypted sync providers via wasm in the browser. */
export async function loadDecryptedAuthProvidersInBrowser(page: Page) {
  return page.evaluate(async () => {
    const hook = (
      window as Window & {
        __nookAuthProviders?: {
          loadAuthProviders: () => Promise<{
            providers: Array<{
              id?: string
              githubPat?: string
              oauthFile?: { accessToken?: string; refreshToken?: string }
            }>
          }>
        }
      }
    ).__nookAuthProviders
    if (hook?.loadAuthProviders) {
      return hook.loadAuthProviders()
    }
    throw new Error('E2E auth provider hooks are unavailable')
  })
}

/** Save sync providers through wasm (plaintext in → sealed in IndexedDB). */
export async function saveAuthProvidersInBrowser(
  page: Page,
  snapshot: RawAuthProvidersSnapshot & {
    activeVaultStoreId?: string
  },
) {
  await page.evaluate(async (value) => {
    const hook = (
      window as Window & {
        __nookAuthProviders?: {
          saveAuthProviders: (snapshot: unknown) => Promise<void>
        }
      }
    ).__nookAuthProviders
    if (hook?.saveAuthProviders) {
      await hook.saveAuthProviders(value)
      return
    }
    throw new Error('E2E auth provider hooks are unavailable')
  }, snapshot)
}

export function expectSealedCredential(
  stored: string | undefined,
  plaintext: string,
) {
  expect(stored).toBeDefined()
  expect(stored).toContain(AGE_ARMOR_MARKER)
  expect(stored).not.toContain(plaintext)
}

/** Default GitHub sync provider for local e2e onboarding / fan-out specs. */
export const E2E_GITHUB_ONBOARD_PROVIDER = {
  id: 'e2e-onboard-github',
  label: 'GitHub (e2e onboard)',
  githubRepo: 'nook-e2e-onboard',
  githubPat: 'ghp_test_token',
}

/** Default file-backed oauth-file sync provider for PR / IndexedDB-only e2e. */
export const E2E_OAUTH_ONBOARD_PROVIDER = {
  id: 'e2e-onboard-file',
  label: 'File (e2e onboard)',
  fileName: 'nook-e2e-onboard',
  accessToken: 'ya29.e2e_file_sync_token',
  accountEmail: 'file-sync-e2e@example.com',
}

/** Alias for local sync provider used in multi-device / fan-out e2e. */
export const E2E_SYNC_ONBOARD_PROVIDER = E2E_OAUTH_ONBOARD_PROVIDER

export type E2eOauthSyncProvider = {
  id: string
  label: string
  fileName: string
  accessToken: string
  accountEmail?: string
}

/** Read canonical local vault YAML bytes stored in IndexedDB (active vault). */
export async function readLocalVaultYamlFromIdb(page: Page): Promise<string> {
  return page.evaluate(() => {
    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('nook_db')
      request.onerror = () =>
        reject(request.error ?? new Error('idb open failed'))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('vault', 'readonly')
        const store = tx.objectStore('vault')
        const readBlob = (key: string) =>
          new Promise<string>((resolveBlob, rejectBlob) => {
            const getReq = store.get(key)
            getReq.onerror = () =>
              rejectBlob(getReq.error ?? new Error('idb read failed'))
            getReq.onsuccess = () => {
              resolveBlob(String(getReq.result ?? ''))
            }
          })
        const activeReq = store.get('active_vault_id')
        activeReq.onerror = () =>
          reject(activeReq.error ?? new Error('idb read failed'))
        activeReq.onsuccess = () => {
          const activeId = String(activeReq.result ?? '').trim()
          if (activeId) {
            void readBlob(`vault:${activeId}`).then(resolve).catch(reject)
            return
          }
          resolve('')
        }
        tx.oncomplete = () => db.close()
      }
    })
  })
}

/** Seed a joiner's local vault copy from remote YAML before password enrollment. */
export async function seedLocalVaultYamlForEnrollment(
  page: Page,
  vaultYaml: string,
) {
  const trimmed = vaultYaml.trim()
  if (!trimmed) {
    throw new Error('seedLocalVaultYamlForEnrollment: vault YAML is empty')
  }
  const storeId = trimmed.match(/^store_id:\s*(\S+)/m)?.[1]
  if (!storeId) {
    throw new Error(
      'seedLocalVaultYamlForEnrollment: store_id missing from yaml',
    )
  }

  await page.evaluate(
    ({ content, storeId: id }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () =>
          reject(request.error ?? new Error('idb open failed'))
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('vault')) {
            db.createObjectStore('vault')
          }
        }
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('vault', 'readwrite')
          const store = tx.objectStore('vault')
          const now = new Date().toISOString()
          const registry = {
            vaults: [
              {
                store_id: id,
                last_unlocked_at: now,
              },
            ],
          }
          store.put(content, `vault:${id}`)
          store.put(id, 'active_vault_id')
          store.put(JSON.stringify(registry), 'vault_registry')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'))
        }
      })
    },
    { content: trimmed, storeId },
  )

  await expect
    .poll(() => readLocalVaultYamlFromIdb(page), { timeout: UI_TIMEOUT_MS })
    .toContain(storeId)
}

/** Poll local vault YAML until predicate passes (local-first canonical copy). */
export async function waitForLocalVaultState(
  page: Page,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const timeoutMs = options?.timeoutMs ?? ENROLLMENT_UNLOCK_TIMEOUT_MS
  // IndexedDB read via page.evaluate — small round-trip, still much cheaper than network.
  const intervalMs = options?.intervalMs ?? 150
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

/** Install oauth-file REST responses with the file-backed provider by default. */
export async function installOauthFileRemoteForLocalE2e(
  page: Page,
  opts: { fileName: string; vaultYaml?: string; accessToken?: string },
  existingStub?: E2eOauthFileStub,
) {
  const stub =
    existingStub ??
    createLocalE2eFileSyncVaultStub(opts.vaultYaml ?? '', opts.fileName)
  if (opts.vaultYaml !== undefined) {
    stub.setVaultYaml(opts.vaultYaml)
  }
  await stub.install(page, {
    vaultYaml: opts.vaultYaml,
    fileName: opts.fileName,
    accessToken: opts.accessToken,
  })
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
  let revision = 0
  let sha = 'e2e-stub-sha-0'
  const eventFiles = new Map<string, string>()
  const eventShas = new Map<string, string>()
  const bumpSha = () => {
    revision += 1
    sha = `e2e-stub-sha-${revision}`
  }

  return {
    getVaultYaml: () => vaultYaml,
    getVaultRevision: () => revision,
    setVaultYaml: (yaml: string) => {
      vaultYaml = yaml
      bumpSha()
    },
    getEventFileCount: () => eventFiles.size,
    getEventFilePaths: () => [...eventFiles.keys()],
    getEventFileContents: () => [...eventFiles.values()],
    clearEventFiles: () => {
      eventFiles.clear()
      eventShas.clear()
    },
    async install(
      page: Page,
      opts: { repoName: string; vaultYaml?: string; username?: string },
    ) {
      if (opts.vaultYaml !== undefined) {
        if (opts.vaultYaml !== vaultYaml) {
          bumpSha()
        }
        vaultYaml = opts.vaultYaml
      }
      const owner = opts.username ?? 'e2e-user'
      const fullRepo = `${owner}/${opts.repoName}`
      const context = page.context()

      const handler = async (route: import('@playwright/test').Route) => {
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
            body: JSON.stringify({
              id: 1,
              name: opts.repoName,
              private: true,
              default_branch: 'main',
            }),
          })
          return
        }
        if (
          url.startsWith(`https://api.github.com/repos/${fullRepo}/git/trees/`)
        ) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              tree: Array.from(eventFiles.keys()).map((path) => ({
                path,
                type: 'blob',
              })),
              truncated: false,
            }),
          })
          return
        }
        const contentsPrefix = `https://api.github.com/repos/${fullRepo}/contents/`
        if (url === contentsPrefix) {
          const files: Array<{ name: string; path: string; type: string }> = []
          if (vaultYaml.trim().length > 0) {
            files.push({
              name: 'nook-events',
              path: 'nook-events',
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
          `https://api.github.com/repos/${fullRepo}/contents/nook-events`
        ) {
          if (method === 'PUT') {
            const body = request.postDataJSON() as {
              content?: string
              sha?: string
            }
            const hasExistingVault = vaultYaml.trim().length > 0
            if (hasExistingVault && body.sha !== sha) {
              await route.fulfill({
                status: body.sha ? 409 : 422,
                contentType: 'application/json',
                body: JSON.stringify({
                  message: 'sha does not match current file',
                }),
              })
              return
            }
            if (body.content) {
              vaultYaml = Buffer.from(body.content, 'base64').toString('utf8')
              bumpSha()
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
        await route.fallback()
      }

      await context.route('https://api.github.com/**', handler)
    },
  }
}

/** Seed sync provider + unlock a keys-mode local vault for multi-device local e2e. */
export async function reloadUnlockLocalVaultWithSync(
  page: Page,
  sharedStub?: E2eOauthFileStub,
) {
  await seedExtraOauthFileProviders(page, [E2E_OAUTH_ONBOARD_PROVIDER])

  const vaultYaml = await readLocalVaultYamlFromIdb(page)
  if (vaultYaml.trim()) {
    await installOauthFileRemoteForLocalE2e(
      page,
      {
        fileName: E2E_OAUTH_ONBOARD_PROVIDER.fileName,
        vaultYaml,
        accessToken: E2E_OAUTH_ONBOARD_PROVIDER.accessToken,
      },
      sharedStub,
    )
  }

  await page.reload()

  if (vaultYaml.trim()) {
    await installOauthFileRemoteForLocalE2e(
      page,
      {
        fileName: E2E_OAUTH_ONBOARD_PROVIDER.fileName,
        vaultYaml,
        accessToken: E2E_OAUTH_ONBOARD_PROVIDER.accessToken,
      },
      sharedStub,
    )
  }

  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await ensureLoginLocalUnlockReady(page)
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
  if (sharedStub) {
    await flushRemoteEventsToSyncProviders(page)
    await expect
      .poll(() => sharedStub.getEventFileCount(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(0)
    sharedStub.setVaultYaml('')
  }
}

/** Connect a joiner browser to a stubbed local sync remote (keys-mode join dialog). */
export async function connectLocalE2eJoinerDevice(
  page: Page,
  fileName: string,
  accessToken = E2E_OAUTH_ONBOARD_PROVIDER.accessToken,
) {
  await installGoogleOAuthMock(page, accessToken)
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await setupGoogleDriveProvider(page, fileName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForJoinEnrollmentDialog(page)
}

/** Send a join request against a stubbed local sync remote (local e2e). */
export async function sendJoinRequestLocalE2e(
  page: Page,
  stub: { getEventFileContents: () => string[] },
) {
  await page.getByTestId('join-enrollment-confirm').click()
  await waitForVaultOperationsIdle(page)
  await waitForStorageChainIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)

  await expect
    .poll(
      () =>
        parseVaultEventLogSnapshot(stub.getEventFileContents()).joinEntries
          .length,
      {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      },
    )
    .toBeGreaterThanOrEqual(1)

  const snapshot = parseVaultEventLogSnapshot(stub.getEventFileContents())
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
  stub: { getEventFileContents: () => string[] },
  expectedMembers: number,
) {
  await waitForPendingJoinOnDevice(page, deviceId)
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })
  await row.getByTestId('approve-join-btn').click()
  await expect
    .poll(
      () =>
        parseVaultEventLogSnapshot(stub.getEventFileContents()).memberPkIds
          .length,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .toBe(expectedMembers)
  await expect
    .poll(
      () =>
        parseVaultEventLogSnapshot(stub.getEventFileContents()).joinEntries
          .length,
    )
    .toBe(0)
  await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
}

/** Add GitHub sync provider stubs while vault stays unlocked (preserves password UI state). */
export async function seedGithubSyncProvidersWhileUnlocked(
  page: Page,
  providers = [E2E_GITHUB_ONBOARD_PROVIDER],
) {
  const vaultYaml = await readLocalVaultYamlFromIdb(page)
  await seedExtraGithubProviders(page, providers)
  for (const provider of providers) {
    await stubGithubVaultForLocalE2e(page, {
      repoName: provider.githubRepo,
      vaultYaml,
    })
  }
  await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: { loadProviders?: () => Promise<void> }
      }
    ).__nookVault
    if (vault?.loadProviders) {
      await vault.loadProviders()
    }
  })
  await waitForLoadedSyncProviders(page, providers.length)
  await forceVaultQuiescentForE2e(page)
}

/** Add oauth-file sync providers with Drive stubs while vault stays unlocked. */
export async function seedOauthFileSyncProvidersWhileUnlocked(
  page: Page,
  providers = [E2E_OAUTH_ONBOARD_PROVIDER],
  sharedStub?: E2eOauthFileStub,
  expectedSyncProviderCount = providers.length,
) {
  const vaultYaml = await readLocalVaultYamlFromIdb(page)
  await seedExtraOauthFileProviders(page, providers)
  for (const provider of providers) {
    await installOauthFileRemoteForLocalE2e(
      page,
      {
        fileName: provider.fileName,
        vaultYaml,
        accessToken: provider.accessToken,
      },
      sharedStub,
    )
  }
  await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: { loadProviders?: () => Promise<void> }
      }
    ).__nookVault
    if (vault?.loadProviders) {
      await vault.loadProviders()
    }
  })
  await waitForLoadedSyncProviders(page, expectedSyncProviderCount)
  await forceVaultQuiescentForE2e(page)
}

/** Seed a local sync provider, reload, unlock, and wait for status bar sync count. */
export async function reloadUnlockWithSyncProvider(
  page: Page,
  opts?: {
    password?: string
    entryLabel?: string
    providers?: E2eOauthSyncProvider[]
    sharedStub?: E2eOauthFileStub
  },
) {
  const providers = opts?.providers ?? [E2E_OAUTH_ONBOARD_PROVIDER]
  const sharedStub = opts?.sharedStub
  await seedExtraOauthFileProviders(page, providers)

  const vaultYaml = await readLocalVaultYamlFromIdb(page)
  if (vaultYaml.trim()) {
    for (const provider of providers) {
      await installOauthFileRemoteForLocalE2e(
        page,
        {
          fileName: provider.fileName,
          vaultYaml,
          accessToken: provider.accessToken,
        },
        sharedStub,
      )
    }
  }

  await page.reload()

  if (vaultYaml.trim()) {
    for (const provider of providers) {
      await installOauthFileRemoteForLocalE2e(
        page,
        {
          fileName: provider.fileName,
          vaultYaml,
          accessToken: provider.accessToken,
        },
        sharedStub,
      )
    }
  }

  // Unlock starts idle tracking asynchronously after the shell first appears.
  // A one-shot stop can therefore run too early and let the 2.5s e2e timeout
  // lock the vault while provider loading is still in progress.
  await keepVaultIdleLockDisabled(page)
  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await ensureLoginLocalUnlockReady(page)
  await unlockVaultOnLogin(
    page,
    opts?.password
      ? { password: opts.password, entryLabel: opts.entryLabel }
      : undefined,
  )
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await dismissSyncConflictIfVisible(page)
  await forceVaultQuiescentForE2e(page)
  await waitForVaultOperationsIdle(page)
  await waitForLoadedSyncProviders(page)
  await waitForVaultSyncIdle(page)
  if (sharedStub) {
    await flushRemoteEventsToSyncProviders(page)
    await expect
      .poll(() => sharedStub.getEventFileCount(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(0)
    sharedStub.setVaultYaml('')
  }
  if (opts?.password) {
    await waitForStableLocalVaultState(
      page,
      (snapshot) => snapshot.hasPasswordEnvelope,
      { timeoutMs: ENROLLMENT_UNLOCK_TIMEOUT_MS, stableReads: 2 },
    )
  }
}

/** Wait until the status bar reflects loaded sync providers. */
export async function waitForLoadedSyncProviders(
  page: Page,
  minCount = 1,
  timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS,
) {
  await assertVaultReady(page)
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => {
          const vault = (
            window as Window & {
              __nookVault?: {
                isAuthenticated?: boolean
                syncProviderCount?: number
                syncProviders?: unknown[]
              }
            }
          ).__nookVault
          return {
            authenticated: Boolean(vault?.isAuthenticated),
            count:
              vault?.syncProviderCount ?? vault?.syncProviders?.length ?? 0,
          }
        })
        if (state.authenticated && state.count < minCount) {
          await invokeVaultLoadProviders(page).catch(() => undefined)
        }
        return state.authenticated ? state.count : -1
      },
      { timeout: timeoutMs },
    )
    .toBeGreaterThanOrEqual(minCount)

  const pattern =
    minCount === 1
      ? /1 sync provider/
      : new RegExp(`${minCount} sync providers`)
  const syncStatus = page.getByTestId('vault-sync-out-status')
  await expect(syncStatus).toBeVisible({ timeout: timeoutMs })
  await expect(syncStatus).toContainText(pattern, { timeout: timeoutMs })
}

async function syncSecretCount(target: GithubE2eTarget): Promise<number> {
  if (target.stub) {
    const events = target.stub.getEventFileContents()
    return events.length > 0
      ? parseVaultEventLogSnapshot(events).secretIds.length
      : 0
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
  await keepVaultIdleLockDisabled(page)
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  const addButton = page.getByTestId('add-secret-btn')
  await expect(addButton).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(addButton).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await addButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(page.getByTestId('add-secret-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page
    .getByTestId('item-type-api-key')
    .click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await page
    .getByTestId('secret-label')
    .fill(key, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await page
    .getByTestId('secret-value')
    .fill(value, { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  const saveButton = page.getByTestId('save-secret-btn')
  await expect(saveButton).toBeEnabled({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await saveButton.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await waitForVaultOperationsIdle(page)
  await assertNoVaultError(page)
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  try {
    await expect(row).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  } catch (error) {
    const debug = await page.evaluate(async (expectedKey) => {
      const vault = (
        window as Window & {
          __nookVault?: {
            secrets?: unknown[]
            storageMode?: string
            localVaultPresent?: boolean
            syncProviders?: unknown[]
            isSaving?: boolean
            isSyncing?: boolean
            errorMsg?: string
          }
        }
      ).__nookVault
      const idbYaml = await new Promise<string>((resolve) => {
        const request = indexedDB.open('nook_db')
        request.onerror = () => resolve(`idb-open-error:${request.error}`)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('vault', 'readonly')
          const store = tx.objectStore('vault')
          const activeReq = store.get('active_vault_id')
          activeReq.onerror = () => resolve(`idb-read-error:${activeReq.error}`)
          activeReq.onsuccess = () => {
            const activeId = String(activeReq.result ?? '').trim()
            if (!activeId) {
              resolve('')
              return
            }
            const getReq = store.get(`vault:${activeId}`)
            getReq.onerror = () => resolve(`idb-read-error:${getReq.error}`)
            getReq.onsuccess = () =>
              resolve(typeof getReq.result === 'string' ? getReq.result : '')
          }
          tx.oncomplete = () => db.close()
        }
      })
      return {
        secrets: vault?.secrets?.length ?? undefined,
        storageMode: vault?.storageMode ?? undefined,
        localVaultPresent: vault?.localVaultPresent ?? undefined,
        syncProviders: vault?.syncProviders?.length ?? undefined,
        isSaving: vault?.isSaving ?? undefined,
        isSyncing: vault?.isSyncing ?? undefined,
        errorMsg: vault?.errorMsg ?? undefined,
        localYamlHasKey: idbYaml.includes(expectedKey),
        localYamlSecretCount:
          idbYaml.match(/\n\s*-\s+id:\s+secret_/g)?.length ?? 0,
      }
    }, key)
    throw new Error(
      `Secret row "${key}" did not appear. Debug: ${JSON.stringify(debug)}. Original: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    )
  }
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
        if (github) {
          try {
            await triggerVaultSyncRefresh(page)
          } catch {
            await page.evaluate(async () => {
              const vault = (
                window as Window & {
                  __nookVault?: {
                    manualSync?: () => Promise<void>
                    syncFromStorage?: (opts?: {
                      force?: boolean
                    }) => Promise<void>
                  }
                }
              ).__nookVault
              if (vault?.manualSync) {
                await vault.manualSync()
              } else {
                await vault?.syncFromStorage?.({ force: true })
              }
            })
          }
        } else {
          await page.evaluate(async () => {
            const vault = (
              window as Window & {
                __nookVault?: {
                  syncFromStorage?: (opts?: {
                    force?: boolean
                  }) => Promise<void>
                }
              }
            ).__nookVault
            await vault?.syncFromStorage?.({ force: true })
          })
        }
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
  const deleteBtn = row.getByTestId('delete-secret-btn')
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

/** @deprecated Use {@link seedOauthFileSyncProvidersWhileUnlocked}. */
export const seedSyncProvidersWhileUnlocked =
  seedOauthFileSyncProvidersWhileUnlocked
