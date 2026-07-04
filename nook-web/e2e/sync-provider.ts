import type { Page } from '@playwright/test'
import { expect } from './fixtures'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'
import { createLocalE2eICloudVaultStub } from './icloud-stub'
import { createE2eStubRepoName } from './sync-stub'
import {
  parseVaultEventLogSnapshot,
  type VaultYamlSnapshot,
} from './vault-yaml'

/** Stub sync backends for e2e (no live cloud unless explicitly selected). */
export type E2eSyncProviderId =
  | 'file'
  | 'local'
  | 'google-drive'
  | 'icloud'
  | 'github'

export type E2eSyncProviderDef = {
  id: E2eSyncProviderId
  /** Login/settings provider picker test id. */
  providerOptionTestId: string
  /** Env var holding live credentials (PAT / OAuth access token). */
  liveCredentialEnv: string
  /** Fake credential for stub mode (never leaves the test runner). */
  stubCredential: string
  /** Human label in status bar / settings copy. */
  label: string
}

export const E2E_SYNC_PROVIDERS: Record<E2eSyncProviderId, E2eSyncProviderDef> =
  {
    local: {
      id: 'local',
      providerOptionTestId: 'provider-option-oauth-file',
      liveCredentialEnv: 'NOOK_LOCAL_E2E_ACCESS_TOKEN',
      stubCredential: 'ya29.e2e_stub_access_token',
      label: 'Google Drive',
    },
    file: {
      id: 'file',
      providerOptionTestId: 'provider-option-oauth-file',
      liveCredentialEnv: 'NOOK_FILE_E2E_ACCESS_TOKEN',
      stubCredential: 'ya29.e2e_file_sync_token',
      label: 'File',
    },
    'google-drive': {
      id: 'google-drive',
      providerOptionTestId: 'provider-option-oauth-file',
      liveCredentialEnv: 'NOOK_GOOGLE_E2E_ACCESS_TOKEN',
      stubCredential: 'ya29.e2e_stub_access_token',
      label: 'Google Drive',
    },
    icloud: {
      id: 'icloud',
      providerOptionTestId: 'provider-option-icloud',
      liveCredentialEnv: 'NOOK_ICLOUD_E2E_WEB_AUTH_TOKEN',
      stubCredential: 'ck-web-auth-e2e-stub-token',
      label: 'iCloud',
    },
    github: {
      id: 'github',
      providerOptionTestId: 'provider-option-github',
      liveCredentialEnv: 'NOOK_GITHUB_PAT',
      stubCredential: 'ghp_test_token',
      label: 'GitHub',
    },
  }

function normalizeProviderId(id: E2eSyncProviderId): E2eSyncProviderId {
  return id === 'local' ? 'local' : id
}

function stubBackendId(
  providerId: E2eSyncProviderId,
): 'file' | 'google-drive' | 'icloud' | 'github' {
  if (providerId === 'file') {
    return 'file'
  }
  if (providerId === 'local' || providerId === 'google-drive') {
    return 'google-drive'
  }
  if (providerId === 'icloud') {
    return 'icloud'
  }
  return 'github'
}

/** Which sync backend to exercise — set per CI job via `NOOK_E2E_SYNC_PROVIDER`. */
export function resolveE2eSyncProvider(): E2eSyncProviderId {
  const raw =
    process.env.NOOK_E2E_SYNC_PROVIDER?.trim().toLowerCase() ?? 'file'
  if (raw in E2E_SYNC_PROVIDERS) {
    return raw as E2eSyncProviderId
  }
  throw new Error(
    `Unknown NOOK_E2E_SYNC_PROVIDER="${raw}". Expected: ${Object.keys(E2E_SYNC_PROVIDERS).join(', ')}`,
  )
}

export function e2eSyncProviderDef(
  id: E2eSyncProviderId = resolveE2eSyncProvider(),
): E2eSyncProviderDef {
  return E2E_SYNC_PROVIDERS[normalizeProviderId(id)]
}

export function liveSyncCredential(
  id: E2eSyncProviderId = resolveE2eSyncProvider(),
): string {
  const def = e2eSyncProviderDef(id)
  return process.env[def.liveCredentialEnv]?.trim() ?? ''
}

export function hasLiveSyncCredential(
  id: E2eSyncProviderId = resolveE2eSyncProvider(),
): boolean {
  return liveSyncCredential(id).length > 0
}

export type SyncStubHandle =
  | ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  | ReturnType<typeof createLocalE2eFileSyncVaultStub>
  | ReturnType<typeof createLocalE2eICloudVaultStub>

type OAuthFileStubHandle =
  | ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  | ReturnType<typeof createLocalE2eFileSyncVaultStub>

/** Remote target for stub sync — `pat` is access token, `repoName` is Drive file name. */
export type SyncE2eTarget = {
  providerId: E2eSyncProviderId
  pat: string
  repoName: string
  stub?: SyncStubHandle
}

function createStubHandle(
  providerId: E2eSyncProviderId,
  initialYaml: string,
  remoteId: string,
): SyncStubHandle {
  const backend = stubBackendId(providerId)
  if (backend === 'file') {
    return createLocalE2eFileSyncVaultStub(initialYaml, remoteId)
  }
  if (backend === 'icloud') {
    return createLocalE2eICloudVaultStub(initialYaml, remoteId)
  }
  return createLocalE2eGoogleDriveVaultStub(initialYaml, remoteId)
}

/** One isolated remote vault per suite — provider chosen by env or override. */
export function createSyncTarget(
  initialYaml = '',
  prefix?: string,
  providerId: E2eSyncProviderId = resolveE2eSyncProvider(),
): SyncE2eTarget {
  const def = e2eSyncProviderDef(providerId)
  const remoteId = createE2eStubRepoName(prefix ?? providerId)
  const stub = createStubHandle(providerId, initialYaml, remoteId)
  return {
    providerId,
    pat: def.stubCredential,
    repoName: remoteId,
    stub,
  }
}

export async function installSyncStub(
  page: Page,
  target: SyncE2eTarget,
  vaultYaml?: string,
) {
  const backend = stubBackendId(target.providerId)
  if (backend === 'file') {
    await (
      target.stub as ReturnType<typeof createLocalE2eFileSyncVaultStub>
    ).install(page, { fileName: target.repoName, vaultYaml })
    return
  }
  if (backend === 'icloud') {
    await (
      target.stub as ReturnType<typeof createLocalE2eICloudVaultStub>
    ).install(page, { fileName: target.repoName, vaultYaml })
    return
  }
  await (
    target.stub as ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  ).install(page, { fileName: target.repoName, vaultYaml })
}

export async function installSyncStubOnPages(
  pages: Page[],
  target: SyncE2eTarget,
  vaultYaml?: string,
) {
  for (const page of pages) {
    await installSyncStub(page, target, vaultYaml)
  }
}

export function resetSyncRemote(target: SyncE2eTarget) {
  target.stub?.setVaultYaml('')
  target.stub?.clearEventFiles()
}

export async function waitForSyncRemoteState(
  target: SyncE2eTarget,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const timeoutMs = options?.timeoutMs ?? 30_000
  const intervalMs = options?.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs
  let lastError = 'stub event log empty'

  while (Date.now() < deadline) {
    const events = target.stub?.getEventFileContents() ?? []
    if (events.length > 0) {
      try {
        const snapshot = parseVaultEventLogSnapshot(events)
        if (predicate(snapshot)) {
          return snapshot
        }
        lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, joins=${snapshot.joinEntries.length})`
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : 'invalid stub event log'
      }
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for stub event log: ${lastError}`)
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function connectSyncVault(page: Page, target: SyncE2eTarget) {
  const backend = stubBackendId(target.providerId)
  if (backend === 'google-drive' || backend === 'file') {
    const { connectGoogleDriveVault } = await import('./helpers')
    await connectGoogleDriveVault(
      page,
      target.pat,
      target.repoName,
      target.stub as OAuthFileStubHandle,
    )
    return
  }
  if (backend === 'github') {
    const { connectGithubVault } = await import('./helpers')
    await connectGithubVault(
      page,
      target.pat,
      target.repoName,
      target.stub as NonNullable<Parameters<typeof connectGithubVault>[3]>,
    )
    return
  }
  throw new Error(
    `connectSyncVault: icloud UI flow not wired in e2e yet (provider=${target.providerId})`,
  )
}

export async function connectSyncGenesisDevice(
  page: Page,
  target: SyncE2eTarget,
) {
  const backend = stubBackendId(target.providerId)
  if (backend === 'google-drive' || backend === 'file') {
    const {
      clearBrowserVault,
      connectLocalVaultLegacy,
      createLocalVaultOnLogin,
      assertVaultReady,
      readLocalVaultYamlFromIdb,
      reloadUnlockWithSyncProvider,
      triggerVaultSyncRefresh,
      disableVaultIdleLock,
      ENROLLMENT_UNLOCK_TIMEOUT_MS,
    } = await import('./helpers')
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await expect(
      page
        .getByTestId('login-create-vault-chooser')
        .or(page.getByTestId('login-local-unlock-step')),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    const chooser = page.getByTestId('login-create-vault-chooser')
    if (await chooser.isVisible()) {
      await createLocalVaultOnLogin(page)
    } else {
      await connectLocalVaultLegacy(page)
    }
    await assertVaultReady(page)
    const genesisYaml = await readLocalVaultYamlFromIdb(page)
    const stub = target.stub as OAuthFileStubHandle
    if (stub) {
      stub.setVaultYaml(genesisYaml)
      await stub.install(page, {
        fileName: target.repoName,
        vaultYaml: genesisYaml,
      })
    }
    await reloadUnlockWithSyncProvider(page, {
      providers: [
        {
          id: 'e2e-genesis-sync',
          label: 'E2E Drive',
          fileName: target.repoName,
          accessToken: target.pat,
        },
      ],
      sharedStub: stub,
    })
    await triggerVaultSyncRefresh(page)
    await disableVaultIdleLock(page)
    return
  }
  if (backend === 'github') {
    const { connectGithubGenesisDevice } = await import('./helpers')
    await connectGithubGenesisDevice(
      page,
      target.pat,
      target.repoName,
      target.stub as never,
    )
    return
  }
  throw new Error(
    `connectSyncGenesisDevice: icloud not wired in e2e yet (provider=${target.providerId})`,
  )
}

export async function connectSyncJoinerDevice(
  page: Page,
  target: SyncE2eTarget,
) {
  const backend = stubBackendId(target.providerId)
  if (backend === 'google-drive' || backend === 'file') {
    const stub = target.stub as OAuthFileStubHandle
    const { assertGenesisVaultOnSyncStub, connectLocalE2eJoinerDevice } =
      await import('./helpers')
    await assertGenesisVaultOnSyncStub(stub)
    if (stub) {
      await stub.install(page, { fileName: target.repoName })
    }
    await connectLocalE2eJoinerDevice(page, target.repoName, target.pat)
    return
  }
  if (backend === 'github') {
    const { connectGithubJoinerDevice } = await import('./helpers')
    await connectGithubJoinerDevice(
      page,
      target.pat,
      target.repoName,
      target.stub as never,
    )
    return
  }
  throw new Error(
    `connectSyncJoinerDevice: icloud not wired in e2e yet (provider=${target.providerId})`,
  )
}

/** Default seeded sync provider row for fan-out / onboarding specs. */
export function defaultOnboardSyncProvider(
  providerId: E2eSyncProviderId = resolveE2eSyncProvider(),
) {
  const backend = stubBackendId(providerId)
  if (backend === 'file') {
    return {
      id: 'e2e-onboard-file',
      label: 'File (e2e onboard)',
      fileName: 'nook-e2e-onboard',
      accessToken: E2E_SYNC_PROVIDERS.file.stubCredential,
      type: 'oauth-file' as const,
      oauthPreset: 'google-drive' as const,
    }
  }
  if (backend === 'github') {
    return {
      id: 'e2e-onboard-github',
      label: 'GitHub (e2e onboard)',
      fileName: 'nook-e2e-onboard',
      accessToken: E2E_SYNC_PROVIDERS.github.stubCredential,
      type: 'github' as const,
      githubRepo: 'nook-e2e-onboard',
      githubPat: E2E_SYNC_PROVIDERS.github.stubCredential,
    }
  }
  return {
    id: 'e2e-onboard-oauth',
    label: 'Google Drive (e2e onboard)',
    fileName: 'nook-projection.yaml',
    accessToken: E2E_SYNC_PROVIDERS.local.stubCredential,
    type: 'oauth-file' as const,
    oauthPreset: 'google-drive' as const,
  }
}
