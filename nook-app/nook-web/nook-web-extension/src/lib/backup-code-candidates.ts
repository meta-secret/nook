const MAX_CANDIDATES = 64
const MAX_CODE_LEN = 64
const MIN_CODE_LEN = 6

const RECOVERY_HINT =
  /\b(?:backup|recovery|one[-\s]?time|emergency|(?:2fa|mfa|authenticator))\s+codes?\b/i

const CODE_LINE = /^(?:[-*•]\s*)?([A-Za-z0-9][A-Za-z0-9 _-]{4,62}[A-Za-z0-9])$/

enum BackupCodeCandidateKind {
  Accepted = 'accepted',
  Rejected = 'rejected',
}

type BackupCodeCandidate =
  | { kind: BackupCodeCandidateKind.Accepted; value: string }
  | { kind: BackupCodeCandidateKind.Rejected }

export function pageHasBackupCodeHint(): boolean {
  const bodyText = document.body?.innerText ?? ''
  return RECOVERY_HINT.test(bodyText)
}

function normalizeCandidate(value: string): BackupCodeCandidate {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (
    trimmed.length < MIN_CODE_LEN ||
    trimmed.length > MAX_CODE_LEN ||
    !CODE_LINE.test(trimmed)
  ) {
    return { kind: BackupCodeCandidateKind.Rejected }
  }
  // Reject ordinary sentences, hint copy, and URLs.
  if (
    trimmed.includes('://') ||
    trimmed.includes('@') ||
    /\s{2,}/.test(trimmed) ||
    RECOVERY_HINT.test(trimmed)
  ) {
    return { kind: BackupCodeCandidateKind.Rejected }
  }
  const words = trimmed.split(' ')
  // Recovery codes are single tokens or short grouped tokens, not prose.
  if (words.length > 2) return { kind: BackupCodeCandidateKind.Rejected }
  if (words.length === 2 && words.every((word) => /^[A-Za-z]+$/.test(word))) {
    return { kind: BackupCodeCandidateKind.Rejected }
  }
  const compact = trimmed.replace(/[\s_-]/g, '')
  if (compact.length < MIN_CODE_LEN) {
    return { kind: BackupCodeCandidateKind.Rejected }
  }
  // Real backup codes always include at least one digit.
  if (!/[0-9]/.test(compact)) {
    return { kind: BackupCodeCandidateKind.Rejected }
  }
  return { kind: BackupCodeCandidateKind.Accepted, value: trimmed }
}

export function extractBackupCodeCandidates(sourceText?: string): string[] {
  const text = sourceText ?? document.body?.innerText ?? ''
  const lines = text.split(/\r?\n/)
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const normalized = normalizeCandidate(line)
    if (
      normalized.kind === BackupCodeCandidateKind.Rejected ||
      seen.has(normalized.value)
    ) {
      continue
    }
    seen.add(normalized.value)
    candidates.push(normalized.value)
    if (candidates.length >= MAX_CANDIDATES) break
  }
  return candidates
}

export function clearBackupCodeCandidates(codes: string[]): void {
  for (let index = 0; index < codes.length; index += 1) {
    codes[index] = ''
  }
  codes.length = 0
}
