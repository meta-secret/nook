export enum MatchingPasskeyAvailabilityKind {
  Ready = 'ready',
  Unavailable = 'unavailable',
}

export type MatchingPasskeyAvailability =
  | { kind: MatchingPasskeyAvailabilityKind.Ready; accountCount: number }
  | { kind: MatchingPasskeyAvailabilityKind.Unavailable }

type PasskeyAccountCountForClassificationArgs = {
  needsPasskeyLookup: boolean
  availability: MatchingPasskeyAvailability
}

export function passkeyAccountCountForClassification({
  needsPasskeyLookup,
  availability,
}: PasskeyAccountCountForClassificationArgs): number {
  if (!needsPasskeyLookup) return 0
  if (availability.kind === MatchingPasskeyAvailabilityKind.Unavailable) {
    return 0
  }
  return availability.accountCount
}
