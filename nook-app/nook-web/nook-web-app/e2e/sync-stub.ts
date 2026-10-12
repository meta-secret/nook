import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  type GithubE2eTarget,
  type VaultEventLogRemote,
} from './helpers'
import {
  waitForVaultEventLogSnapshot,
  type VaultYamlSnapshot,
} from './vault-yaml'

export type StubSyncTarget = GithubE2eTarget & {
  stub: VaultEventLogRemote
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
      timeoutMs: ((...[v = ENROLLMENT_UNLOCK_TIMEOUT_MS]) => v)(
        options?.timeoutMs,
      ),
      intervalMs: ((...[v = 100]) => v)(options?.intervalMs),
    },
  )
}
