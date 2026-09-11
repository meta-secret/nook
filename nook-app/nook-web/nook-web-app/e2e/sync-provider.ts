import type { Page } from '@playwright/test'
import { expect } from './fixtures'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'
import { createLocalE2eGithubVaultStub } from './helpers/local-sync'
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

type GithubRemoteHandle = ReturnType<typeof createLocalE2eGithubVaultStub>
type ICloudRemoteHandle = ReturnType<typeof createLocalE2eICloudVaultStub>

export type LocalFileSyncE2eTarget = {
  providerId: E2eSyncProviderId.File | E2eSyncProviderId.Local
  pat: string
  repoName: string
  stub: ReturnType<typeof createLocalE2eFileSyncVaultStub>
}

export type GoogleDriveSyncE2eTarget = {
  providerId: E2eSyncProviderId.GoogleDrive
  pat: string
  repoName: string
  stub: ReturnType<typeof createLocalE2eGoogleDriveVaultStub>
}

export type OAuthFileSyncE2eTarget =
  LocalFileSyncE2eTarget | GoogleDriveSyncE2eTarget

export type ICloudSyncE2eTarget = {
  providerId: E2eSyncProviderId.ICloud
  pat: string
  repoName: string
  stub: ICloudRemoteHandle
}

export type GithubSyncE2eTarget = {
  providerId: E2eSyncProviderId.GitHub
  pat: string
  repoName: string
  stub?: GithubRemoteHandle
}

/** Remote target for e2e sync — `pat` is access token, `repoName` is the remote file/repo id. */
export type SyncE2eTarget =
  | LocalFileSyncE2eTarget
  | GoogleDriveSyncE2eTarget
  | ICloudSyncE2eTarget
  | GithubSyncE2eTarget

export function isOauthFileSyncTarget(
  target: SyncE2eTarget,
): target is LocalFileSyncE2eTarget | GoogleDriveSyncE2eTarget {
  return (
    target.providerId === E2eSyncProviderId.File ||
    target.providerId === E2eSyncProviderId.Local ||
    target.providerId === E2eSyncProviderId.GoogleDrive
  )
}

/** One isolated remote vault per suite — provider chosen by env or override. */
export function createSyncTarget(
  initialYaml: string,
  prefix: string,
  providerId: E2eSyncProviderId.File | E2eSyncProviderId.Local,
): LocalFileSyncE2eTarget
export function createSyncTarget(
  initialYaml: string,
  prefix: string,
  providerId: E2eSyncProviderId.GoogleDrive,
): GoogleDriveSyncE2eTarget
export function createSyncTarget(
  initialYaml: string,
  prefix: string,
  providerId: E2eSyncProviderId.ICloud,
): ICloudSyncE2eTarget
export function createSyncTarget(
  initialYaml: string,
  prefix: string,
  providerId: E2eSyncProviderId.GitHub,
): GithubSyncE2eTarget
export function createSyncTarget(
  initialYaml?: string,
  prefix?: string,
  providerId?: E2eSyncProviderId,
): SyncE2eTarget
export function createSyncTarget(
  initialYaml = '',
  prefix?: string,
  providerId: E2eSyncProviderId = resolveE2eSyncProvider(),
): SyncE2eTarget {
  const def = e2eSyncProviderDef(providerId)
  const remoteId = createE2eRemoteName(((...[v = providerId]) => v)(prefix))
  if (
    providerId === E2eSyncProviderId.File ||
    providerId === E2eSyncProviderId.Local
  ) {
    return {
      pat: def.stubCredential,
      repoName: remoteId,
      providerId,
      stub: createLocalE2eFileSyncVaultStub(initialYaml, remoteId),
    }
  }
  if (providerId === E2eSyncProviderId.GoogleDrive) {
    return {
      pat: def.stubCredential,
      repoName: remoteId,
      providerId,
      stub: createLocalE2eGoogleDriveVaultStub(initialYaml, remoteId),
    }
  }
  if (providerId === E2eSyncProviderId.ICloud) {
    return {
      pat: def.stubCredential,
      repoName: remoteId,
      providerId,
      stub: createLocalE2eICloudVaultStub(initialYaml, remoteId),
    }
  }
  return {
    pat: def.stubCredential,
    repoName: remoteId,
    providerId,
    stub: createLocalE2eGithubVaultStub(initialYaml),
  }
}

export async function installSyncRemote(
  page: Page,
  target: SyncE2eTarget,
  vaultYaml?: string,
) {
  if (
    target.providerId === E2eSyncProviderId.File ||
    target.providerId === E2eSyncProviderId.Local ||
    target.providerId === E2eSyncProviderId.GoogleDrive
  ) {
    const installRequest: {
      fileName: string
      accessToken: string
      vaultYaml?: string
    } = {
      fileName: target.repoName,
      accessToken: target.pat,
    }
    if (vaultYaml) installRequest.vaultYaml = vaultYaml
    await target.stub.install(page, installRequest)
    return
  }
  if (target.providerId === E2eSyncProviderId.ICloud) {
    const installRequest: { fileName: string; vaultYaml?: string } = {
      fileName: target.repoName,
    }
    if (vaultYaml) installRequest.vaultYaml = vaultYaml
    await target.stub.install(page, installRequest)
    return
  }
  if (!target.stub) return
  const installRequest: { repoName: string; vaultYaml?: string } = {
    repoName: target.repoName,
  }
  if (vaultYaml) installRequest.vaultYaml = vaultYaml
  await target.stub.install(page, installRequest)
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
    () => target.stub?.getEventFileContents() || [],
    predicate,
    {
      timeoutMs: ((...[v = 30_000]) => v)(options?.timeoutMs),
      intervalMs: ((...[v = 100]) => v)(options?.intervalMs),
    },
  )
}

export async function connectSyncVault(page: Page, target: SyncE2eTarget) {
  if (
    target.providerId === E2eSyncProviderId.GoogleDrive ||
    target.providerId === E2eSyncProviderId.File ||
    target.providerId === E2eSyncProviderId.Local
  ) {
    const { connectGoogleDriveVault } = await import('./helpers')
    await connectGoogleDriveVault(
      page,
      target.pat,
      target.repoName,
      target.stub,
    )
    return
  }
  if (target.providerId === E2eSyncProviderId.GitHub) {
    const { connectGithubVault } = await import('./helpers')
    await connectGithubVault(page, target.pat, target.repoName, target.stub)
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
  if (
    target.providerId === E2eSyncProviderId.GoogleDrive ||
    target.providerId === E2eSyncProviderId.File ||
    target.providerId === E2eSyncProviderId.Local
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
    const remote = target.stub
    remote.setVaultYaml(genesisYaml)
    await remote.install(page, {
      fileName: target.repoName,
      vaultYaml: genesisYaml,
      accessToken: target.pat,
    })
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
  if (target.providerId === E2eSyncProviderId.GitHub) {
    const { connectGithubGenesisDevice } = await import('./helpers')
    await connectGithubGenesisDevice(
      page,
      target.pat,
      target.repoName,
      target.stub,
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
  if (
    target.providerId === E2eSyncProviderId.GoogleDrive ||
    target.providerId === E2eSyncProviderId.File ||
    target.providerId === E2eSyncProviderId.Local
  ) {
    const remote = target.stub
    const { assertGenesisVaultOnSyncRemote, connectLocalE2eJoinerDevice } =
      await import('./helpers')
    await assertGenesisVaultOnSyncRemote(remote)
    await remote.install(page, {
      fileName: target.repoName,
      accessToken: target.pat,
    })
    await connectLocalE2eJoinerDevice(page, target.repoName, target.pat)
    return
  }
  if (target.providerId === E2eSyncProviderId.GitHub) {
    const { connectGithubJoinerDevice } = await import('./helpers')
    await connectGithubJoinerDevice(
      page,
      target.pat,
      target.repoName,
      target.stub,
    )
    return
  }
  throw new Error(
    `connectSyncJoinerDevice: icloud not wired in e2e yet (provider=${target.providerId})`,
  )
}
