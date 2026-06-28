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
    console.log(`[e2e] shared GitHub repo: ${override}`)
    return override
  }

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const repoName = `nook-${suffix}`
  registerE2eGithubRepo(repoName)
  cachedE2eGithubRepoName = repoName
  console.log(`[e2e] GitHub repo: ${repoName}`)
  return repoName
}

/** UI actions we control should complete in a couple of seconds. */
export const UI_TIMEOUT_MS = 5_000
/** Password unlock / enrollment runs scrypt in wasm — allow more time on CI. */
export const ENROLLMENT_UNLOCK_TIMEOUT_MS = 30_000

/** Default password used by e2e create-vault and local-unlock helpers. */
export const DEFAULT_LOCAL_VAULT_PASSWORD = 'test-local-vault-password'

export async function openLoginProviderSetup(page: Page) {
  const connectBtn = page.getByTestId('login-connect-storage-btn')
  if (await connectBtn.isVisible()) {
    await connectBtn.click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    return
  }
  const legacyLink = page.getByTestId('login-use-storage-provider-link')
  if (await legacyLink.isVisible()) {
    await legacyLink.click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    return
  }
  const addBtn = page.getByTestId('add-provider-btn')
  if (await addBtn.isVisible()) {
    await addBtn.click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  }
}

/** @deprecated Use {@link openLoginProviderSetup}. */
export const openLegacyProviderSetup = openLoginProviderSetup

export async function createLocalVaultOnLogin(page: Page) {
  await page.getByTestId('login-create-device-vault-btn').click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
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
    return
  }

  const localUnlock = page.getByTestId('login-local-unlock-step')
  if (await localUnlock.isVisible()) {
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    return
  }

  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-local').click()
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
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

export type GithubE2eTarget = { pat: string; repoName: string }

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

/** A few background sync ticks — scales with VITE_VAULT_SYNC_INTERVAL_MS. */
export const NOTIFICATION_TIMEOUT_MS = Math.max(
  UI_TIMEOUT_MS,
  configuredVaultSyncIntervalMs() * 4,
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
    const deleteRes = await githubApiFetch(pat, contentsUrl, {
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
      await assertNoVaultErrors(options.page)
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

async function assertNoVaultErrors(page: Page) {
  const vaultError = page.getByTestId('vault-error')
  if (await vaultError.isVisible()) {
    throw new Error(`Vault error: ${await vaultError.textContent()}`)
  }
}

/** Wait until GitHub has the expected vault state (source of truth for sync). */
export async function waitForGithubVaultState(
  target: GithubE2eTarget,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number; page?: Page },
): Promise<VaultYamlSnapshot> {
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
  const error = page.getByTestId('vault-error')
  if (await error.isVisible()) {
    throw new Error(`GitHub connect failed: ${await error.textContent()}`)
  }
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
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
) {
  const target = { pat, repoName }
  await page.goto('/')
  await setupGithubProvider(page, pat, repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await waitForGithubVaultState(
    target,
    (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
    { page, timeoutMs: GITHUB_CONNECT_TIMEOUT_MS },
  )
  await assertNoVaultErrors(page)
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
}

/** Second device: same repo → join enrollment dialog. */
export async function connectGithubJoinerDevice(
  page: Page,
  pat: string,
  repoName: string,
) {
  await assertGenesisVaultOnGithub(pat, repoName)
  await page.goto('/')
  await clearBrowserVault(page)
  await page.reload()
  await setupGithubProvider(page, pat, repoName)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await assertNoVaultErrors(page)
  await expect(page.getByTestId('join-enrollment-dialog')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('join-enrollment-confirm')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

export async function sendJoinRequest(
  page: Page,
  pat: string,
  repoName: string,
) {
  await page.getByTestId('join-enrollment-confirm').click()

  const snapshot = await waitForGithubVaultState(
    { pat, repoName },
    (yaml) => yaml.joinEntries.length >= 1 || joinCountFromYaml(yaml.raw) >= 1,
    { page },
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

export async function approveJoinFromBanner(
  page: Page,
  deviceId: string,
  target: GithubE2eTarget,
  expectedMembers: number,
) {
  await waitForPendingJoinOnDevice(page, deviceId)
  const row = page.getByTestId('device-join-row').filter({ hasText: deviceId })
  await row.getByTestId('approve-join-btn').click()
  await assertEnrolledVaultOnGithub(
    target.pat,
    target.repoName,
    expectedMembers,
  )
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
  const row = page.getByTestId('pending-join-row').filter({ hasText: deviceId })
  await row.getByTestId('approve-join-btn').click()
  await assertEnrolledVaultOnGithub(
    target.pat,
    target.repoName,
    expectedMembers,
  )
  await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })
}

export async function unlockGithubVault(page: Page) {
  await page.goto('/')
  const vaultPanel = page.getByTestId('vault-panel')
  const autoUnlocked = await vaultPanel
    .waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false)
  if (autoUnlocked) {
    return
  }
  await unlockVaultOnLogin(page)
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
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
) {
  await expandSettingsSection(page, 'unlock')
  await page.getByTestId('set-vault-password-btn').click()
  await page.getByTestId('vault-password-label').fill(label)
  await page.getByTestId('vault-password-input').fill(password)
  await page.getByTestId('vault-password-confirm').fill(password)
  await page.getByTestId('submit-vault-password').click()
}

/** Issue an onboard enrollment code and return the code textarea locator. */
export async function submitOnboardEnrollmentCode(
  page: Page,
  password: string,
) {
  await expect(page.getByTestId('onboard-device-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('onboard-device-submit')).toBeEnabled({
    timeout: UI_TIMEOUT_MS,
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

/** Reconnect after reload — auto-unlocks when a saved provider exists. */
export async function reconnectGithubVault(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

export async function assertVaultReady(page: Page) {
  await expect(page.getByTestId('vault-panel')).toBeVisible()
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
  await page.getByTestId(`login-unlock-method-${method}`).click()
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

/** Stub GitHub REST responses so local e2e can exercise sync-provider enrollment. */
export async function stubGithubVaultForLocalE2e(
  page: Page,
  opts: { repoName: string; vaultYaml: string; username?: string },
) {
  const stub = createLocalE2eGithubVaultStub(opts.vaultYaml)
  await stub.install(page, opts)
}

/** In-memory GitHub vault stub with GET/PUT support for local multi-device e2e. */
export function createLocalE2eGithubVaultStub(initialYaml = '') {
  let vaultYaml = initialYaml
  let sha = 'e2e-stub-sha'

  return {
    getVaultYaml: () => vaultYaml,
    setVaultYaml: (yaml: string) => {
      vaultYaml = yaml
    },
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
        if (url === `https://api.github.com/repos/${fullRepo}/contents/`) {
          const files =
            vaultYaml.trim().length > 0
              ? [
                  {
                    name: 'nook-vault.yaml',
                    path: 'nook-vault.yaml',
                    type: 'file',
                  },
                ]
              : []
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
        await route.fulfill({ status: 404, body: '{}' })
      })
    },
  }
}

/** Seed sync provider + unlock a keys-mode local vault for multi-device local e2e. */
export async function reloadUnlockLocalVaultWithGithubSync(page: Page) {
  await seedExtraGithubProviders(page, [E2E_GITHUB_ONBOARD_PROVIDER])
  await page.reload()
  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await selectLoginUnlockMethod(page, 'keys')
  await page.getByTestId('unlock-vault-btn').click()
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await waitForLoadedSyncProviders(page)
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
  await assertNoVaultErrors(page)
  await expect(page.getByTestId('join-enrollment-dialog')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('join-enrollment-confirm')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

/** Send a join request against a stubbed GitHub repo (local e2e). */
export async function sendJoinRequestLocalE2e(
  page: Page,
  stub: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  await page.getByTestId('join-enrollment-confirm').click()

  await expect
    .poll(() => joinCountFromYaml(stub.getVaultYaml()), {
      timeout: UI_TIMEOUT_MS,
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
  await seedExtraGithubProviders(
    page,
    opts?.providers ?? [E2E_GITHUB_ONBOARD_PROVIDER],
  )
  await page.reload()
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
  await waitForLoadedSyncProviders(page)
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

export async function addSecret(
  page: Page,
  key: string,
  value: string,
  github?: GithubE2eTarget,
) {
  const beforeCount = github
    ? parseVaultYamlSnapshot(
        (await fetchGithubVaultYaml(github.pat, github.repoName)) ??
          'secrets: []',
      ).secretIds.length
    : 0
  await assertVaultReady(page)
  await page.getByTestId('add-secret-btn').click()
  await expect(page.getByTestId('add-secret-panel')).toBeVisible()
  await page.getByTestId('item-type-api-key').click()
  await page.getByTestId('secret-label').fill(key)
  await page.getByTestId('secret-value').fill(value)
  await page.getByTestId('save-secret-btn').click()
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS })
  if (github) {
    await waitForGithubVaultState(
      github,
      (yaml) => yaml.secretIds.length > beforeCount,
      { page },
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
  const refresh = page.getByTestId('vault-sync-refresh-btn')
  const timeout = github ? configuredGithubSyncTimeoutMs() : UI_TIMEOUT_MS

  await expect
    .poll(
      async () => {
        if (await row.isVisible()) return true
        if ((await refresh.isVisible()) && (await refresh.isEnabled())) {
          await refresh.click()
        }
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
  const beforeCount = github
    ? parseVaultYamlSnapshot(
        (await fetchGithubVaultYaml(github.pat, github.repoName)) ??
          'secrets: []',
      ).secretIds.length
    : 0
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await row.getByRole('button', { name: 'Delete item' }).click()
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
