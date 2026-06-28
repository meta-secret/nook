import type { Page } from '@playwright/test'
import {
  createLocalE2eGithubVaultStub,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  type GithubE2eTarget,
} from './helpers'
import { parseVaultYamlSnapshot, type VaultYamlSnapshot } from './vault-yaml'

/** Fake PAT accepted by Playwright route stubs — never hits api.github.com. */
export const E2E_STUB_PAT = 'ghp_test_token'

export type StubSyncTarget = GithubE2eTarget & {
  stub: ReturnType<typeof createLocalE2eGithubVaultStub>
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Unique repo name per suite — no GitHub API registration or cleanup. */
export function createE2eStubRepoName(prefix = 'nook-stub'): string {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `${prefix}-${suffix}`
}

/** @deprecated Use {@link createSyncTarget} from `./sync-provider`. */
export function createStubSyncTarget(
  initialYaml = '',
  prefix?: string,
): StubSyncTarget {
  const repoName = createE2eStubRepoName(prefix)
  const stub = createLocalE2eGithubVaultStub(initialYaml)
  return { pat: E2E_STUB_PAT, repoName, stub }
}

export function resetStubVault(target: StubSyncTarget) {
  target.stub.setVaultYaml('')
}

export async function installStubOnPage(
  page: Page,
  target: StubSyncTarget,
  vaultYaml?: string,
) {
  await target.stub.install(page, {
    repoName: target.repoName,
    vaultYaml,
  })
}

export async function installStubOnPages(
  pages: Page[],
  target: StubSyncTarget,
  vaultYaml?: string,
) {
  for (const page of pages) {
    await installStubOnPage(page, target, vaultYaml)
  }
}

/** Poll in-memory stub YAML (mirrors waitForGithubVaultState without API calls). */
export async function waitForStubVaultState(
  target: StubSyncTarget,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const timeoutMs = options?.timeoutMs ?? ENROLLMENT_UNLOCK_TIMEOUT_MS
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
