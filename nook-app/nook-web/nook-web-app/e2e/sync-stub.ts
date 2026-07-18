import {
  createLocalE2eGithubVaultStub,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  type GithubE2eTarget,
} from './helpers'
import {
  parseVaultEventLogSnapshot,
  type VaultYamlSnapshot,
} from './vault-yaml'

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
