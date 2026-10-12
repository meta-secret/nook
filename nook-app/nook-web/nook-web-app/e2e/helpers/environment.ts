import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

dotenv.config({
  path: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../.env.test.local',
  ),
})

export const githubPat = ((v) => (v ? v : ''))(
  process.env.NOOK_GITHUB_PAT?.trim(),
)
/** Password unlock / enrollment runs scrypt in wasm — allow more time on CI. */
export const ENROLLMENT_UNLOCK_TIMEOUT_MS = 30_000

export function configuredGithubPollIntervalMs(): number {
  const parsed = Number(process.env.NOOK_GITHUB_POLL_MS)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 3_000
}

export function configuredGithubSyncTimeoutMs(): number {
  const parsed = Number(process.env.NOOK_GITHUB_SYNC_TIMEOUT_MS)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 15_000
}

/** GitHub YAML polls are slow by design — prefer fewer API calls over fast failure. */
export const GITHUB_SYNC_TIMEOUT_MS = configuredGithubSyncTimeoutMs()
export const GITHUB_SYNC_INTERVAL_MS = configuredGithubPollIntervalMs()

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
