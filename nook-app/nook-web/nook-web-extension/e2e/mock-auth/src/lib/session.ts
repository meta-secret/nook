const PENDING_KEY = 'mock-auth-pending'

export type PendingTotpSession = {
  username: string
  totpSecret: string
}

export function setPendingTotpSession(session: PendingTotpSession): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(session))
}

export function readPendingTotpSession(): PendingTotpSession | void {
  const raw = sessionStorage.getItem(PENDING_KEY)
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as PendingTotpSession
    if (
      typeof parsed?.username === 'string' &&
      typeof parsed?.totpSecret === 'string'
    ) {
      return parsed
    }
  } catch {
    // ignore corrupt session
  }
  return
}

export function clearPendingTotpSession(): void {
  sessionStorage.removeItem(PENDING_KEY)
}
