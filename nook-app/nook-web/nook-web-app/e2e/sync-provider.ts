import type { Page } from '@playwright/test'
import type { createLocalE2eGithubVaultStub } from './helpers'
import { expect } from './fixtures'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'
import { createLocalE2eICloudVaultStub } from './icloud-stub'
import { createE2eRemoteName } from './sync-stub'
import {
  waitForVaultEventLogSnapshot,
  type VaultYamlSnapshot,
} from './vault-yaml'

/** Sync backends for e2e (no live cloud unless explicitly selected). */
export enum E2eSyncProviderId {
  File = 'file',
  Local = 'local',
  GoogleDrive = 'google-drive',
  ICloud = 'icloud',
  GitHub = 'github',
}

enum E2eSyncStubBackend {
  File = 'file',
  GoogleDrive = 'google-drive',
  ICloud = 'icloud',
  GitHub = 'github',
}

export type E2eSyncProviderDef = {
  id: E2eSyncProviderId
  /** Login/settings provider picker test id. */
  providerOptionTestId: string
  /** Env var holding live credentials (PAT / OAuth access token). */
  liveCredentialEnv: string
  /** Test credential for local e2e mode (never leaves the test runner). */
  stubCredential: string
  /** Human label in status bar / settings copy. */
  label: string
}

export const E2E_SYNC_PROVIDERS: Record<E2eSyncProviderId, E2eSyncProviderDef> =
  {
    [E2eSyncProviderId.Local]: {
      id: E2eSyncProviderId.Local,
      providerOptionTestId: 'provider-option-oauth-file',
      liveCredentialEnv: 'NOOK_FILE_E2E_ACCESS_TOKEN',
      stubCredential: 'ya29.e2e_file_sync_token',
      label: 'File',
    },
    [E2eSyncProviderId.File]: {
      id: E2eSyncProviderId.File,
      providerOptionTestId: 'provider-option-oauth-file',
      liveCredentialEnv: 'NOOK_FILE_E2E_ACCESS_TOKEN',
      stubCredential: 'ya29.e2e_file_sync_token',
      label: 'File',
    },
    [E2eSyncProviderId.GoogleDrive]: {
      id: E2eSyncProviderId.GoogleDrive,
      providerOptionTestId: 'provider-option-oauth-file',
      liveCredentialEnv: 'NOOK_GOOGLE_E2E_ACCESS_TOKEN',
      stubCredential: 'ya29.e2e_stub_access_token',
      label: 'Google Drive',
    },
    [E2eSyncProviderId.ICloud]: {
      id: E2eSyncProviderId.ICloud,
      providerOptionTestId: 'provider-option-icloud',
      liveCredentialEnv: 'NOOK_ICLOUD_E2E_WEB_AUTH_TOKEN',
      stubCredential: 'ck-web-auth-e2e-stub-token',
      label: 'iCloud',
    },
    [E2eSyncProviderId.GitHub]: {
      id: E2eSyncProviderId.GitHub,
      providerOptionTestId: 'provider-option-github',
      liveCredentialEnv: 'NOOK_GITHUB_PAT',
      stubCredential: 'ghp_test_token',
      label: 'GitHub',
    },
  }

function stubBackendId(providerId: E2eSyncProviderId): E2eSyncStubBackend {
  if (
    providerId === E2eSyncProviderId.File ||
    providerId === E2eSyncProviderId.Local
  ) {
    return E2eSyncStubBackend.File
  }
  if (providerId === E2eSyncProviderId.GoogleDrive) {
    return E2eSyncStubBackend.GoogleDrive
  }
  if (providerId === E2eSyncProviderId.ICloud) {
    return E2eSyncStubBackend.ICloud
  }
  return E2eSyncStubBackend.GitHub
}

/** Which sync backend to exercise — set per CI job via `NOOK_E2E_SYNC_PROVIDER`. */
export function resolveE2eSyncProvider(): E2eSyncProviderId {
  const [raw = E2eSyncProviderId.File] = [
    process.env.NOOK_E2E_SYNC_PROVIDER?.trim().toLowerCase(),
  ]
  switch (raw) {
    case E2eSyncProviderId.File:
    case E2eSyncProviderId.Local:
    case E2eSyncProviderId.GoogleDrive:
    case E2eSyncProviderId.ICloud:
    case E2eSyncProviderId.GitHub:
      return raw
  }
  throw new Error(
    `Unknown NOOK_E2E_SYNC_PROVIDER="${raw}". Expected: ${Object.keys(E2E_SYNC_PROVIDERS).join(', ')}`,
  )
}

export function e2eSyncProviderDef(
  id: E2eSyncProviderId = resolveE2eSyncProvider(),
): E2eSyncProviderDef {
  return E2E_SYNC_PROVIDERS[id]
}

export function liveSyncCredential(
  id: E2eSyncProviderId = resolveE2eSyncProvider(),
): string {
  const def = e2eSyncProviderDef(id)
  return ((v) => (v ? v : ''))(process.env[def.liveCredentialEnv]?.trim())
}

export function hasLiveSyncCredential(
  id: E2eSyncProviderId = resolveE2eSyncProvider(),
): boolean {
  return liveSyncCredential(id).length > 0
}

export type SyncRemoteHandle =
  | ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  | ReturnType<typeof createLocalE2eFileSyncVaultStub>
  | ReturnType<typeof createLocalE2eICloudVaultStub>
  | ReturnType<typeof createLocalE2eGithubVaultStub>

type OAuthFileRemoteHandle =
  | ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  | ReturnType<typeof createLocalE2eFileSyncVaultStub>
type GithubRemoteHandle = ReturnType<typeof createLocalE2eGithubVaultStub>

/** Remote target for e2e sync — `pat` is access token, `repoName` is the remote file/repo id. */
export type SyncE2eTarget = {
  providerId: E2eSyncProviderId
  pat: string
  repoName: string
  stub?: SyncRemoteHandle
}

function createStubHandle(
  providerId: E2eSyncProviderId,
  initialYaml: string,
  remoteId: string,
): SyncRemoteHandle {
  const backend = stubBackendId(providerId)
  if (backend === E2eSyncStubBackend.File) {
    return createLocalE2eFileSyncVaultStub(initialYaml, remoteId)
  }
  if (backend === E2eSyncStubBackend.ICloud) {
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
  const remoteId = createE2eRemoteName(((...[v = providerId]) => v)(prefix))
  const stub = createStubHandle(providerId, initialYaml, remoteId)
  return {
    providerId,
    pat: def.stubCredential,
    repoName: remoteId,
    stub,
  }
}

export async function installSyncRemote(
  page: Page,
  target: SyncE2eTarget,
  vaultYaml?: string,
) {
  const backend = stubBackendId(target.providerId)
  if (backend === E2eSyncStubBackend.File) {
    await (
      target.stub as ReturnType<typeof createLocalE2eFileSyncVaultStub>
    ).install(page, {
      fileName: target.repoName,
      vaultYaml,
      accessToken: target.pat,
    })
    return
  }
  if (backend === E2eSyncStubBackend.ICloud) {
    await (
      target.stub as ReturnType<typeof createLocalE2eICloudVaultStub>
    ).install(page, { fileName: target.repoName, vaultYaml })
    return
  }
  await (
    target.stub as ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
  ).install(page, { fileName: target.repoName, vaultYaml })
}

export async function installSyncRemoteOnPages(
  pages: Page[],
  target: SyncE2eTarget,
  vaultYaml?: string,
) {
  for (const page of pages) {
    await installSyncRemote(page, target, vaultYaml)
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
  return waitForVaultEventLogSnapshot(
    () => ((v) => (v ? v : []))(target.stub?.getEventFileContents()),
    predicate,
    {
      timeoutMs: ((...[v = 30_000]) => v)(options?.timeoutMs),
      intervalMs: ((...[v = 100]) => v)(options?.intervalMs),
    },
  )
}

export async function connectSyncVault(page: Page, target: SyncE2eTarget) {
  const backend = stubBackendId(target.providerId)
  if (
    backend === E2eSyncStubBackend.GoogleDrive ||
    backend === E2eSyncStubBackend.File
  ) {
    const { connectGoogleDriveVault } = await import('./helpers')
    await connectGoogleDriveVault(
      page,
      target.pat,
      target.repoName,
      target.stub as OAuthFileRemoteHandle,
    )
    return
  }
  if (backend === E2eSyncStubBackend.GitHub) {
    const { connectGithubVault } = await import('./helpers')
    await connectGithubVault(
      page,
      target.pat,
      target.repoName,
      target.stub as GithubRemoteHandle,
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
  if (
    backend === E2eSyncStubBackend.GoogleDrive ||
    backend === E2eSyncStubBackend.File
  ) {
    const {
      clearBrowserVault,
      connectLocalVault,
      createLocalVaultOnLogin,
      assertVaultReady,
      readLocalVaultYamlFromIdb,
      reloadUnlockWithSyncProvider,
      triggerVaultSyncRefresh,
      disableVaultIdleLock,
      ENROLLMENT_UNLOCK_TIMEOUT_MS,
    } = await import('./helpers')
    await page.goto('/app/')
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
      await connectLocalVault(page)
    }
    await assertVaultReady(page)
    const genesisYaml = await readLocalVaultYamlFromIdb(page)
    const remote = target.stub as OAuthFileRemoteHandle
    if (remote) {
      remote.setVaultYaml(genesisYaml)
      await remote.install(page, {
        fileName: target.repoName,
        vaultYaml: genesisYaml,
        accessToken: target.pat,
      })
    }
    await reloadUnlockWithSyncProvider(page, {
      providers: [
        {
          id: 'e2e-genesis-sync',
          label: e2eSyncProviderDef(target.providerId).label,
          fileName: target.repoName,
          accessToken: target.pat,
        },
      ],
      sharedStub: remote,
    })
    await triggerVaultSyncRefresh(page)
    await disableVaultIdleLock(page)
    return
  }
  if (backend === E2eSyncStubBackend.GitHub) {
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
  if (
    backend === E2eSyncStubBackend.GoogleDrive ||
    backend === E2eSyncStubBackend.File
  ) {
    const remote = target.stub as OAuthFileRemoteHandle
    const { assertGenesisVaultOnSyncRemote, connectLocalE2eJoinerDevice } =
      await import('./helpers')
    await assertGenesisVaultOnSyncRemote(remote)
    if (remote) {
      await remote.install(page, {
        fileName: target.repoName,
        accessToken: target.pat,
      })
    }
    await connectLocalE2eJoinerDevice(page, target.repoName, target.pat)
    return
  }
  if (backend === E2eSyncStubBackend.GitHub) {
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
