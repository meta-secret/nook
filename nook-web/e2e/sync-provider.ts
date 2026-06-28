import type { Page } from '@playwright/test'
import {
  connectGithubGenesisDevice,
  connectGithubJoinerDevice,
  connectGithubVault,
  createLocalE2eGithubVaultStub,
  E2E_GITHUB_ONBOARD_PROVIDER,
  type GithubE2eTarget,
} from './helpers'
import { createLocalE2eGoogleDriveVaultStub } from './drive-stub'
import { E2E_STUB_PAT, createE2eStubRepoName } from './sync-stub'
import { parseVaultYamlSnapshot, type VaultYamlSnapshot } from './vault-yaml'

/** Sync providers supported in Playwright e2e (stub + live). */
export type E2eSyncProviderId = 'github' | 'google-drive'

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
    github: {
      id: 'github',
      providerOptionTestId: 'provider-option-github',
      liveCredentialEnv: 'NOOK_GITHUB_PAT',
      stubCredential: E2E_STUB_PAT,
      label: 'GitHub',
    },
    'google-drive': {
      id: 'google-drive',
      providerOptionTestId: 'provider-option-oauth-file',
      liveCredentialEnv: 'NOOK_GOOGLE_E2E_ACCESS_TOKEN',
      stubCredential: 'ya29.e2e_stub_access_token',
      label: 'Google Drive',
    },
  }

/** Which sync backend to exercise — set per CI job via `NOOK_E2E_SYNC_PROVIDER`. */
export function resolveE2eSyncProvider(): E2eSyncProviderId {
  const raw =
    process.env.NOOK_E2E_SYNC_PROVIDER?.trim().toLowerCase() ?? 'github'
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
  return E2E_SYNC_PROVIDERS[id]
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
  | ReturnType<typeof createLocalE2eGithubVaultStub>
  | ReturnType<typeof createLocalE2eGoogleDriveVaultStub>

export type SyncE2eTarget = GithubE2eTarget & {
  providerId: E2eSyncProviderId
  stub?: SyncStubHandle
}

function createStubHandle(
  providerId: E2eSyncProviderId,
  initialYaml: string,
  remoteId: string,
): SyncStubHandle {
  if (providerId === 'google-drive') {
    return createLocalE2eGoogleDriveVaultStub(initialYaml, remoteId)
  }
  return createLocalE2eGithubVaultStub(initialYaml)
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
  if (target.providerId === 'github') {
    await (
      target.stub as ReturnType<typeof createLocalE2eGithubVaultStub>
    ).install(page, { repoName: target.repoName, vaultYaml })
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
  target.stub.setVaultYaml('')
}

export async function waitForSyncRemoteState(
  target: SyncE2eTarget,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const timeoutMs = options?.timeoutMs ?? 30_000
  const intervalMs = options?.intervalMs ?? 500
  const deadline = Date.now() + timeoutMs
  let lastError = 'stub vault empty'

  while (Date.now() < deadline) {
    const yaml = target.stub.getVaultYaml()
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
  if (target.providerId === 'github') {
    await connectGithubVault(
      page,
      target.pat,
      target.repoName,
      target.stub as
        | ReturnType<typeof createLocalE2eGithubVaultStub>
        | undefined,
    )
    return
  }
  throw new Error(
    `connectSyncVault: google-drive live/stub UI flow not wired in e2e yet (provider=${target.providerId})`,
  )
}

export async function connectSyncGenesisDevice(
  page: Page,
  target: SyncE2eTarget,
) {
  if (target.providerId === 'github') {
    await connectGithubGenesisDevice(
      page,
      target.pat,
      target.repoName,
      target.stub as ReturnType<typeof createLocalE2eGithubVaultStub>,
    )
    return
  }
  throw new Error(
    `connectSyncGenesisDevice: google-drive not wired in e2e yet (provider=${target.providerId})`,
  )
}

export async function connectSyncJoinerDevice(
  page: Page,
  target: SyncE2eTarget,
) {
  if (target.providerId === 'github') {
    await connectGithubJoinerDevice(
      page,
      target.pat,
      target.repoName,
      target.stub as ReturnType<typeof createLocalE2eGithubVaultStub>,
    )
    return
  }
  throw new Error(
    `connectSyncJoinerDevice: google-drive not wired in e2e yet (provider=${target.providerId})`,
  )
}

/** Default seeded sync provider row for fan-out / onboarding specs. */
export function defaultOnboardSyncProvider(
  providerId: E2eSyncProviderId = resolveE2eSyncProvider(),
) {
  const def = e2eSyncProviderDef(providerId)
  if (providerId === 'github') {
    return E2E_GITHUB_ONBOARD_PROVIDER
  }
  return {
    id: 'e2e-onboard-drive',
    label: `${def.label} (e2e onboard)`,
    githubRepo: 'nook-vault.yaml',
    githubPat: def.stubCredential,
  }
}
