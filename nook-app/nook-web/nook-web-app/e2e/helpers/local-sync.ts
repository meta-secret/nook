import { expect, type Page } from '@playwright/test'
import { createLocalE2eGoogleDriveVaultStub } from '../drive-stub'
import { createLocalE2eFileSyncVaultStub } from '../file-sync-stub'
import { fetchGithubEventLog, GithubEventLogFetchKind } from '../github-api'
import {
  parseVaultEventLogSnapshot,
  parseVaultYamlSnapshot,
  type VaultYamlSnapshot,
} from '../vault-yaml'
import {
  E2E_GITHUB_ONBOARD_PROVIDER,
  E2E_OAUTH_ONBOARD_PROVIDER,
  seedExtraGithubProviders,
  seedExtraOauthFileProviders,
  type E2eOauthSyncProvider,
} from './auth-providers'
import { keepVaultIdleLockDisabled } from './device-enrollment'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  sleep,
} from './environment'
import {
  flushRemoteEventsToSyncProviders,
  type GithubE2eTarget,
} from './github-sync'
import {
  assertVaultReady,
  dismissSyncConflictIfVisible,
  ensureLoginLocalUnlockReady,
  invokeInitializedVaultProviderReload,
  unlockVaultOnLogin,
  waitForStableLocalVaultState,
} from './settings-auth'
import {
  disableVaultIdleLock,
  forceVaultQuiescentForE2e,
  waitForVaultOperationsIdle,
  waitForVaultSyncIdle,
} from './vault-runtime'
import { requireRecord } from './guards'

export type E2eOauthFileStub =
  | ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  | ReturnType<typeof createLocalE2eFileSyncVaultStub>

/** Read canonical local vault YAML bytes stored in IndexedDB (active vault). */
export async function readLocalVaultYamlFromIdb(page: Page): Promise<string> {
  return page.evaluate(() => {
    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('nook_db')
      request.onerror = () =>
        reject(((v) => (v ? v : new Error('idb open failed')))(request.error))
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('vault', 'readonly')
        const store = tx.objectStore('vault')
        const readBlob = (key: string) =>
          new Promise<string>((resolveBlob, rejectBlob) => {
            const getReq = store.get(key)
            getReq.onerror = () =>
              rejectBlob(
                ((v) => (v ? v : new Error('idb read failed')))(getReq.error),
              )
            getReq.onsuccess = () => {
              const value: unknown = getReq.result
              resolveBlob(typeof value === 'string' ? value : '')
            }
          })
        const activeReq = store.get('active_vault_id')
        activeReq.onerror = () =>
          reject(
            ((v) => (v ? v : new Error('idb read failed')))(activeReq.error),
          )
        activeReq.onsuccess = () => {
          const activeValue: unknown = activeReq.result
          const activeId =
            typeof activeValue === 'string' ? activeValue.trim() : ''
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

/** Poll local vault YAML until predicate passes (local-first canonical copy). */
export async function waitForLocalVaultState(
  page: Page,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const [timeoutMs = ENROLLMENT_UNLOCK_TIMEOUT_MS] = [options?.timeoutMs]
  // IndexedDB read via page.evaluate — small round-trip, still much cheaper than network.
  const [intervalMs = 150] = [options?.intervalMs]
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
  const [
    stub = createLocalE2eFileSyncVaultStub(
      ((v) => (v ? v : ''))(opts.vaultYaml),
      opts.fileName,
    ),
  ] = [existingStub]
  if (typeof opts.vaultYaml === 'string') {
    stub.setVaultYaml(opts.vaultYaml)
  }
  await stub.install(page, {
    ...(typeof opts.vaultYaml === 'string'
      ? { vaultYaml: opts.vaultYaml }
      : {}),
    fileName: opts.fileName,
    ...(typeof opts.accessToken === 'string'
      ? { accessToken: opts.accessToken }
      : {}),
  })
}

/** Stub GitHub REST responses so local e2e can exercise sync-provider enrollment. */
export async function stubGithubVaultForLocalE2e(
  page: Page,
  opts: { repoName: string; vaultYaml?: string; username?: string },
  existingStub?: ReturnType<typeof createLocalE2eGithubVaultStub>,
) {
  const [
    stub = createLocalE2eGithubVaultStub(((v) => (v ? v : ''))(opts.vaultYaml)),
  ] = [existingStub]
  if (typeof opts.vaultYaml === 'string' && !existingStub) {
    stub.setVaultYaml(opts.vaultYaml)
  }
  await stub.install(page, opts)
}

/** Every identity and vault lives under one root; an identity's control log
 * sits in its folder's `log`, apart from its vaults. */
const GITHUB_PROVIDER_ROOT_PREFIX = 'meta-secret-nook/'
const GITHUB_IDENTITY_LOG_PATH = /^meta-secret-nook\/[^/]+\/log\//

export enum ListGithubStubDirResultType {
  File = 'file',
  Dir = 'dir',
}

export enum GithubStubFailureScenario {
  None = 'none',
  UserUnauthorized = 'user-unauthorized',
  EventLogForbidden = 'event-log-forbidden',
}

export function listGithubStubDir(
  eventFiles: Map<string, string>,
  relativePath: string,
): Array<{
  name: string
  path: string
  type: ListGithubStubDirResultType.File | ListGithubStubDirResultType.Dir
}> {
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
      type: ListGithubStubDirResultType.Dir as const,
    })),
    ...[...files].sort().map((name) => ({
      name,
      path: `${relativePath}/${name}`,
      type: ListGithubStubDirResultType.File as const,
    })),
  ]
}

/** In-memory GitHub vault stub with GET/PUT support for local multi-device e2e. */
export function createLocalE2eGithubVaultStub(initialYaml = '') {
  let vaultYaml = initialYaml
  let revision = 0
  let sha = 'e2e-stub-sha-0'
  let failureScenario = GithubStubFailureScenario.None
  const failureResponses: Array<{
    method: string
    path: string
    status: number
  }> = []
  const eventFiles = new Map<string, string>()
  const eventShas = new Map<string, string>()
  const bumpSha = () => {
    revision += 1
    sha = `e2e-stub-sha-${revision}`
  }
  /** Vault events in any identity's folder, never identity logs. */
  const vaultEventPaths = () =>
    [...eventFiles.keys()].filter(
      (path) => !GITHUB_IDENTITY_LOG_PATH.test(path),
    )

  return {
    getVaultYaml: () => vaultYaml,
    getVaultRevision: () => revision,
    setVaultYaml: (yaml: string) => {
      vaultYaml = yaml
      bumpSha()
    },
    getEventFileCount: () => vaultEventPaths().length,
    getEventFilePaths: () => vaultEventPaths(),
    getEventFileContents: () =>
      vaultEventPaths().flatMap((path) => {
        const content = eventFiles.get(path)
        return typeof content === 'string' ? [content] : []
      }),
    getIdentityEventFileCount: () => eventFiles.size - vaultEventPaths().length,
    getFailureResponses: () => [...failureResponses],
    setFailureScenario: (scenario: GithubStubFailureScenario) => {
      failureScenario = scenario
      failureResponses.length = 0
    },
    clearEventFiles: () => {
      eventFiles.clear()
      eventShas.clear()
    },
    async install(
      page: Page,
      opts: { repoName: string; vaultYaml?: string; username?: string },
    ) {
      if (typeof opts.vaultYaml === 'string') {
        if (opts.vaultYaml !== vaultYaml) {
          bumpSha()
        }
        vaultYaml = opts.vaultYaml
      }
      const [owner = 'e2e-user'] = [opts.username]
      const fullRepo = `${owner}/${opts.repoName}`
      const context = page.context()

      const handler = async (route: import('@playwright/test').Route) => {
        const request = route.request()
        const [url = ''] = [request.url().split('?')[0]]
        const method = request.method()

        if (url === 'https://api.github.com/user') {
          if (failureScenario === GithubStubFailureScenario.UserUnauthorized) {
            failureResponses.push({ method, path: '/user', status: 401 })
            await route.fulfill({
              status: 401,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Bad credentials' }),
            })
            return
          }
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
              type: ListGithubStubDirResultType.File,
            })
          }
          if (eventFiles.size > 0) {
            files.push({
              name: 'meta-secret-nook',
              path: 'meta-secret-nook',
              type: ListGithubStubDirResultType.Dir,
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
            const body = requireRecord(
              request.postDataJSON(),
              'GitHub upload request',
            )
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
            if (typeof body.content === 'string' && body.content) {
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
        if (url.startsWith(`${contentsPrefix}${GITHUB_PROVIDER_ROOT_PREFIX}`)) {
          if (failureScenario === GithubStubFailureScenario.EventLogForbidden) {
            failureResponses.push({
              method,
              path: url.slice('https://api.github.com'.length),
              status: 403,
            })
            await route.fulfill({
              status: 403,
              contentType: 'application/json',
              body: JSON.stringify({
                message: 'Resource not accessible by integration',
              }),
            })
            return
          }
          const relativePath = url.slice(contentsPrefix.length)
          if (method === 'PUT') {
            const body = requireRecord(
              request.postDataJSON(),
              'GitHub event upload request',
            )
            if (typeof body.content === 'string' && body.content) {
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
                  sha: ((...[v = sha]) => v)(eventShas.get(relativePath)),
                },
              }),
            })
            return
          }
          const stored = eventFiles.get(relativePath)
          if (typeof stored === 'string') {
            const encoded = Buffer.from(stored, 'utf8').toString('base64')
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                content: encoded,
                sha: ((...[v = sha]) => v)(eventShas.get(relativePath)),
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

  await keepVaultIdleLockDisabled(page)
  try {
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await expect(
      page.getByTestId('vault-panel').or(page.getByTestId('vault-admin-panel')),
    ).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await dismissSyncConflictIfVisible(page)
    await expect
      .poll(
        () => page.evaluate(() => window.__nookVault?.isVerifying === false),
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      .toBe(true)
    await disableVaultIdleLock(page)
    await waitForVaultOperationsIdle(page)
    await forceVaultQuiescentForE2e(page)
    await waitForLoadedSyncProviders(page)
    await waitForVaultSyncIdle(page)
    if (typeof sharedStub === 'object') {
      await flushRemoteEventsToSyncProviders(page)
      await expect
        .poll(() => sharedStub.getEventFileCount(), {
          timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
        })
        .toBeGreaterThan(0)
      sharedStub.setVaultYaml('')
    }
  } finally {
    await page.evaluate(() => {
      const w = window as Window & { __nookE2eIdleGuard?: number }
      if (typeof w.__nookE2eIdleGuard === 'number') {
        window.clearInterval(w.__nookE2eIdleGuard)
        delete w.__nookE2eIdleGuard
      }
    })
  }
}

/** Add GitHub sync provider stubs while vault stays unlocked (preserves password UI state). */
export async function seedGithubSyncProvidersWhileUnlocked(
  page: Page,
  providers = [E2E_GITHUB_ONBOARD_PROVIDER],
  expectedSyncProviderCount = providers.length,
) {
  const vaultYaml = await readLocalVaultYamlFromIdb(page)
  await seedExtraGithubProviders(page, providers)
  for (const provider of providers) {
    await stubGithubVaultForLocalE2e(page, {
      repoName: provider.githubRepo,
      vaultYaml,
    })
  }
  await invokeInitializedVaultProviderReload(page)
  await waitForLoadedSyncProviders(page, expectedSyncProviderCount)
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
  await invokeInitializedVaultProviderReload(page)
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
  const [providers = [E2E_OAUTH_ONBOARD_PROVIDER]] = [opts?.providers]
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
  if (opts?.password) {
    const unlockRequest: { password: string; entryLabel?: string } = {
      password: opts.password,
    }
    if (opts.entryLabel) unlockRequest.entryLabel = opts.entryLabel
    await unlockVaultOnLogin(page, unlockRequest)
  } else {
    await unlockVaultOnLogin(page)
  }
  await expect(
    page.getByTestId('vault-panel').or(page.getByTestId('vault-admin-panel')),
  ).toBeVisible({
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
  let loadedProviderCount = 0
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
          const [providerCount = vault?.syncProviders?.length] = [
            vault?.syncProviderCount,
          ]
          return {
            authenticated: Boolean(vault?.isAuthenticated),
            count: ((v) => (v ? v : 0))(providerCount),
          }
        })
        loadedProviderCount = state.authenticated ? state.count : -1
        if (state.authenticated && state.count < minCount) {
          await invokeInitializedVaultProviderReload(page).catch(() => {})
        }
        return loadedProviderCount
      },
      { timeout: timeoutMs },
    )
    .toBeGreaterThanOrEqual(minCount)

  const pattern =
    loadedProviderCount === 0
      ? /No sync providers/
      : loadedProviderCount === 1
        ? /1 sync provider/
        : new RegExp(`${loadedProviderCount} sync providers`)
  const syncStatus = page.getByTestId('vault-sync-out-status')
  await expect(syncStatus).toBeVisible({ timeout: timeoutMs })
  await expect(syncStatus).toContainText(pattern, { timeout: timeoutMs })
}

export async function syncSecretCount(
  target: GithubE2eTarget,
): Promise<number> {
  if (target.stub) {
    const events = target.stub.getEventFileContents()
    return events.length > 0
      ? parseVaultEventLogSnapshot(events).secretIds.length
      : 0
  }
  const result = await fetchGithubEventLog(target.pat, target.repoName)
  return parseVaultEventLogSnapshot(
    result.kind === GithubEventLogFetchKind.Available ? result.eventYamls : [],
  ).secretIds.length
}
