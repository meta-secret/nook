import type { Page } from '@playwright/test'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'
import { createLocalE2eICloudVaultStub } from './icloud-stub'
import { createE2eStubRepoName } from './sync-stub'
import { parseVaultYamlSnapshot, type VaultYamlSnapshot } from './vault-yaml'

/** In-memory stub sync — default for all stub e2e (no GitHub). */
export type E2eSyncProviderId = 'local' | 'google-drive' | 'icloud' | 'github'

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
): 'google-drive' | 'icloud' | 'github' {
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
    process.env.NOOK_E2E_SYNC_PROVIDER?.trim().toLowerCase() ?? 'local'
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
  | ReturnType<typeof createLocalE2eICloudVaultStub>

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
}

export async function waitForSyncRemoteState(
  target: SyncE2eTarget,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const timeoutMs = options?.timeoutMs ?? 30_000
  const intervalMs = options?.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs
  let lastError = 'stub vault empty'

  while (Date.now() < deadline) {
    const yaml = target.stub?.getVaultYaml() ?? ''
    if (yaml.trim()) {
      const snapshot = parseVaultYamlSnapshot(yaml)
      if (predicate(snapshot)) {
        return snapshot
      }
      lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, joins=${snapshot.joinEntries.length})`
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for stub vault YAML: ${lastError}`)
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function connectSyncVault(page: Page, target: SyncE2eTarget) {
  const backend = stubBackendId(target.providerId)
  if (backend === 'google-drive') {
    const { connectGoogleDriveVault } = await import('./helpers')
    await connectGoogleDriveVault(
      page,
      target.pat,
      target.repoName,
      target.stub as ReturnType<typeof createLocalE2eGoogleDriveVaultStub>,
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
  if (backend === 'google-drive') {
    const { connectGoogleDriveGenesisDevice } = await import('./helpers')
    await connectGoogleDriveGenesisDevice(
      page,
      target.pat,
      target.repoName,
      target.stub as ReturnType<typeof createLocalE2eGoogleDriveVaultStub>,
    )
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
  if (backend === 'google-drive') {
    const { connectGoogleDriveJoinerDevice } = await import('./helpers')
    await connectGoogleDriveJoinerDevice(
      page,
      target.pat,
      target.repoName,
      target.stub as ReturnType<typeof createLocalE2eGoogleDriveVaultStub>,
    )
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
    fileName: 'nook-vault.yaml',
    accessToken: E2E_SYNC_PROVIDERS.local.stubCredential,
    type: 'oauth-file' as const,
    oauthPreset: 'google-drive' as const,
  }
}
