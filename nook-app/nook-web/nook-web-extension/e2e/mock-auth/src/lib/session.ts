const PENDING_KEY = 'mock-auth-pending'

export type PendingTotpSession = {
  username: string
  totpSecret: string
}

export enum PendingTotpSessionLookupKind {
  Missing = 'missing',
  Found = 'found',
}

export type PendingTotpSessionLookup =
  | { kind: PendingTotpSessionLookupKind.Missing }
  | {
      kind: PendingTotpSessionLookupKind.Found
      session: PendingTotpSession
    }

export function setPendingTotpSession(session: PendingTotpSession): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(session))
}

export function readPendingTotpSession(): PendingTotpSessionLookup {
  const raw = sessionStorage.getItem(PENDING_KEY)
  if (!raw) return { kind: PendingTotpSessionLookupKind.Missing }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed &&
      'username' in parsed &&
      typeof parsed.username === 'string' &&
      'totpSecret' in parsed &&
      typeof parsed.totpSecret === 'string'
    ) {
      return {
        kind: PendingTotpSessionLookupKind.Found,
        session: { username: parsed.username, totpSecret: parsed.totpSecret },
      }
    }
  } catch {
    // ignore corrupt session
  }
  return { kind: PendingTotpSessionLookupKind.Missing }
}

export function clearPendingTotpSession(): void {
  sessionStorage.removeItem(PENDING_KEY)
}
