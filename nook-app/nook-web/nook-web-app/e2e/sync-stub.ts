import type { Page } from '@playwright/test'
import {
  createLocalE2eGithubVaultStub,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  type GithubE2eTarget,
} from './helpers'
import {
  parseVaultEventLogSnapshot,
  type VaultYamlSnapshot,
} from './vault-yaml'

/** Fake PAT accepted by Playwright route stubs — never hits api.github.com. */
export const E2E_STUB_PAT = 'ghp_test_token'

export type StubSyncTarget = GithubE2eTarget & {
  stub: ReturnType<typeof createLocalE2eGithubVaultStub>
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Unique remote id per suite — no live provider registration or cleanup. */
export function createE2eRemoteName(prefix = 'nook-e2e'): string {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `${prefix}-${suffix}`
}

/** @deprecated Use {@link createSyncTarget} from `./sync-provider`. */
export function createStubSyncTarget(
  initialYaml = '',
  prefix?: string,
): StubSyncTarget {
  const repoName = createE2eRemoteName(prefix)
  const stub = createLocalE2eGithubVaultStub(initialYaml)
  return { pat: E2E_STUB_PAT, repoName, stub }
}

export function resetStubVault(target: StubSyncTarget) {
  target.stub.setVaultYaml('')
  target.stub.clearEventFiles()
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

/** Poll in-memory provider events (mirrors waitForGithubVaultState without API calls). */
export async function waitForStubVaultState(
  target: StubSyncTarget,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  const timeoutMs = options?.timeoutMs ?? ENROLLMENT_UNLOCK_TIMEOUT_MS
  // Pure in-memory read (no network, no page round-trip) — poll fast.
  const intervalMs = options?.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs
  let lastError = 'remote event log empty'

  while (Date.now() < deadline) {
    const events = target.stub.getEventFileContents()
    if (events.length > 0) {
      try {
        const snapshot = parseVaultEventLogSnapshot(events)
        if (predicate(snapshot)) {
          return snapshot
        }
        lastError = `predicate not satisfied (secrets=${snapshot.secretIds.length}, joins=${snapshot.joinEntries.length})`
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : 'invalid remote event log'
      }
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for remote event log: ${lastError}`)
}
