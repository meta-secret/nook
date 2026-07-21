const MAX_CANDIDATES = 64
const MAX_CODE_LEN = 64
const MIN_CODE_LEN = 6

const RECOVERY_HINT =
  /\b(backup|recovery|one[-\s]?time|emergency)\s+codes?\b|\b2fa\b|\bmfa\b|\bauthenticator\b/i

const CODE_LINE =
  /^(?:[-*•]\s*)?([A-Za-z0-9][A-Za-z0-9 _-]{4,62}[A-Za-z0-9])$/

export function pageHasBackupCodeHint(): boolean {
  const bodyText = document.body?.innerText ?? ''
  return RECOVERY_HINT.test(bodyText)
}

function normalizeCandidate(value: string): string | undefined {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (
    trimmed.length < MIN_CODE_LEN ||
    trimmed.length > MAX_CODE_LEN ||
    !CODE_LINE.test(trimmed)
  ) {
    return undefined
  }
  // Reject ordinary sentences and URLs.
  if (trimmed.includes('://') || trimmed.includes('@') || /\s{2,}/.test(trimmed)) {
    return undefined
  }
  const compact = trimmed.replace(/[\s_-]/g, '')
  if (compact.length < MIN_CODE_LEN) return undefined
  // Prefer tokens that look like recovery codes (mixed alnum / grouped).
  if (!/[0-9]/.test(compact) && compact.length > 20) return undefined
  return trimmed
}

export function extractBackupCodeCandidates(
  sourceText?: string,
): string[] {
  const text = sourceText ?? document.body?.innerText ?? ''
  const lines = text.split(/\r?\n/)
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const normalized = normalizeCandidate(line)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    candidates.push(normalized)
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
