import {
  createLocalE2eGithubVaultStub,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  type GithubE2eTarget,
} from './helpers'
import {
  waitForVaultEventLogSnapshot,
  type VaultYamlSnapshot,
} from './vault-yaml'

export type StubSyncTarget = GithubE2eTarget & {
  stub: ReturnType<typeof createLocalE2eGithubVaultStub>
}

/** Unique remote id per suite — no live provider registration or cleanup. */
export function createE2eRemoteName(prefix = 'nook-e2e'): string {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `${prefix}-${suffix}`
}

/** Poll in-memory provider events (mirrors waitForGithubVaultState without API calls). */
export async function waitForStubVaultState(
  target: StubSyncTarget,
  predicate: (snapshot: VaultYamlSnapshot) => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<VaultYamlSnapshot> {
  return waitForVaultEventLogSnapshot(
    target.stub.getEventFileContents,
    predicate,
    {
      timeoutMs: options?.timeoutMs ?? ENROLLMENT_UNLOCK_TIMEOUT_MS,
      intervalMs: options?.intervalMs ?? 100,
    },
  )
}
