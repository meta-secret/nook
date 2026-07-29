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
    const parsed = JSON.parse(raw) as PendingTotpSession
    if (
      typeof parsed?.username === 'string' &&
      typeof parsed?.totpSecret === 'string'
    ) {
      return { kind: PendingTotpSessionLookupKind.Found, session: parsed }
    }
  } catch {
    // ignore corrupt session
  }
  return { kind: PendingTotpSessionLookupKind.Missing }
}

export function clearPendingTotpSession(): void {
  sessionStorage.removeItem(PENDING_KEY)
}
