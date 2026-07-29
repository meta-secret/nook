import { omittedValue } from '../../../nook-web-shared/src/explicit-state'
import { expect, type Page } from '@playwright/test'
import { createLocalE2eGoogleDriveVaultStub } from '../drive-stub'
import { createLocalE2eFileSyncVaultStub } from '../file-sync-stub'
import { fetchGithubVaultYaml } from '../github-api'
import {
  assertJoinPendingYaml,
  parseVaultEventLogSnapshot,
  parseVaultYamlSnapshot,
  type VaultYamlSnapshot,
} from '../vault-yaml'
import {
  E2E_GITHUB_ONBOARD_PROVIDER,
  E2E_OAUTH_ONBOARD_PROVIDER,
  E2eOauthSyncProvider,
  seedExtraGithubProviders,
  seedExtraOauthFileProviders,
} from './auth-providers'
import {
  keepVaultIdleLockDisabled,
  waitForJoinEnrollmentDialog,
  waitForPendingJoinOnDevice,
} from './device-enrollment'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  sleep,
} from './environment'
import {
  GithubE2eTarget,
  flushRemoteEventsToSyncProviders,
} from './github-sync'
import {
  assertVaultReady,
  dismissSyncConflictIfVisible,
  ensureLoginLocalUnlockReady,
  invokeVaultLoadProviders,
  selectLoginUnlockMethod,
  unlockVaultOnLogin,
  waitForStableLocalVaultState,
} from './settings-auth'
import {
  clearBrowserVault,
  disableVaultIdleLock,
  forceVaultQuiescentForE2e,
  installGoogleOAuthMock,
  setupGoogleDriveProvider,
  waitForEngine,
  waitForStorageChainIdle,
  waitForVaultOperationsIdle,
  waitForVaultSyncIdle,
} from './vault-runtime'

export type E2eOauthFileStub =
  | ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  | ReturnType<typeof createLocalE2eFileSyncVaultStub>

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
  if (typeof opts.vaultYaml !== 'undefined') {
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
  if (typeof opts.vaultYaml !== 'undefined' && !existingStub) {
    stub.setVaultYaml(opts.vaultYaml)
  }
  await stub.install(page, opts)
}

export function listGithubStubDir(
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
      if (typeof opts.vaultYaml !== 'undefined') {
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
          if (typeof stored !== 'undefined') {
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
      : omittedValue(),
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
          await invokeVaultLoadProviders(page).catch(() => {})
        }
        return state.authenticated ? state.count : -1
      },
      { timeout: timeoutMs },
    )
    .toBeGreaterThanOrEqual(minCount)

  const pattern =
    minCount === 0
      ? /No sync providers/
      : minCount === 1
        ? /1 sync provider/
        : new RegExp(`${minCount} sync providers`)
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
  const yaml = await fetchGithubVaultYaml(target.pat, target.repoName)
  return parseVaultYamlSnapshot(yaml ?? 'secrets: []').secretIds.length
}
