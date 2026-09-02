import type { EnrollmentRevokeOutcome } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
const TOMBSTONE_TTL_MS = 5 * 60 * 1_000
const MAX_TOMBSTONES_PER_ORIGIN = 128
const MAX_TOMBSTONE_ORIGINS = 32
export interface EnrollmentStageKey {
  origin: string
  stageId: string
}

export type PendingEnrollmentLease = {
  stageId: string
  origin: string
  uri: { value: string }
  cancelled: boolean
}

export type AuthenticatorEnrollmentDismissed = {
  ok: true
  outcome: EnrollmentRevokeOutcome
}

const revokedStages = new Map<string, Map<string, number>>()

function purgeExpired(now = Date.now()): void {
  for (const [origin, stages] of revokedStages) {
    for (const [stageId, expiresAt] of stages) {
      if (expiresAt <= now) stages.delete(stageId)
    }
    if (stages.size === 0) revokedStages.delete(origin)
  }
}

export function enrollmentStageIsRevoked(stage: EnrollmentStageKey): boolean {
  purgeExpired()
  return revokedStages.get(stage.origin)?.has(stage.stageId) === true
}

export function revokeEnrollmentStage(stage: EnrollmentStageKey): boolean {
  const now = Date.now()
  purgeExpired(now)
  let stages = revokedStages.get(stage.origin)
  if (!stages) {
    if (revokedStages.size >= MAX_TOMBSTONE_ORIGINS) return false
    stages = new Map()
    revokedStages.set(stage.origin, stages)
  }
  if (!stages.has(stage.stageId) && stages.size >= MAX_TOMBSTONES_PER_ORIGIN)
    return false
  stages.set(stage.stageId, now + TOMBSTONE_TTL_MS)
  return true
}
