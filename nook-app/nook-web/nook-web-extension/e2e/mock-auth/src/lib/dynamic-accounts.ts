/** Session-scoped accounts created by the mock signup flow. */

export type DynamicMockAuthAccount = {
  username: string
  password: string
}

const STORAGE_KEY = 'nook-mock-auth-dynamic-accounts'

function readAccounts(): DynamicMockAuthAccount[] {
  try {
    // localStorage so a later tab in the same browser context can sign in.
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (value): value is DynamicMockAuthAccount =>
        Boolean(value) &&
        typeof value === 'object' &&
        typeof (value as DynamicMockAuthAccount).username === 'string' &&
        typeof (value as DynamicMockAuthAccount).password === 'string',
    )
  } catch {
    return []
  }
}

function writeAccounts(accounts: DynamicMockAuthAccount[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts))
}

export function registerDynamicMockAuthAccount(
  username: string,
  password: string,
): void {
  const next = readAccounts().filter((account) => account.username !== username)
  next.push({ username, password })
  writeAccounts(next)
}

export function findDynamicMockAuthAccount(
  username: string,
  password: string,
): DynamicMockAuthAccount | undefined {
  return readAccounts().find(
    (account) => account.username === username && account.password === password,
  )
}
