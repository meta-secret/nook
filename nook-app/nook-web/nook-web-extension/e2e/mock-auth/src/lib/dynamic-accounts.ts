/** Session-scoped accounts created by the mock signup flow. */

export type DynamicMockAuthAccount = {
  username: string
  password: string
}

export enum DynamicMockAuthAccountLookupKind {
  Missing = 'missing',
  Found = 'found',
}

export type DynamicMockAuthAccountLookup =
  | { kind: DynamicMockAuthAccountLookupKind.Missing }
  | {
      kind: DynamicMockAuthAccountLookupKind.Found
      account: DynamicMockAuthAccount
    }

const STORAGE_KEY = 'nook-mock-auth-dynamic-accounts'

enum DynamicMockAuthAccountDecodeKind {
  Rejected = 'rejected',
  Decoded = 'decoded',
}

type DynamicMockAuthAccountDecode =
  | { kind: DynamicMockAuthAccountDecodeKind.Rejected }
  | {
      kind: DynamicMockAuthAccountDecodeKind.Decoded
      account: DynamicMockAuthAccount
    }

class DynamicMockAuthAccountStore {
  read(): DynamicMockAuthAccount[] {
    try {
      // localStorage so a later tab in the same browser context can sign in.
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      const accounts: DynamicMockAuthAccount[] = []
      for (const value of parsed) {
        const decoded = this.decode(value)
        if (decoded.kind === DynamicMockAuthAccountDecodeKind.Decoded) {
          accounts.push(decoded.account)
        }
      }
      return accounts
    } catch {
      return []
    }
  }

  write(accounts: DynamicMockAuthAccount[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts))
  }

  private decode(value: unknown): DynamicMockAuthAccountDecode {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('username' in value) ||
      typeof value.username !== 'string' ||
      !('password' in value) ||
      typeof value.password !== 'string'
    ) {
      return { kind: DynamicMockAuthAccountDecodeKind.Rejected }
    }
    return {
      kind: DynamicMockAuthAccountDecodeKind.Decoded,
      account: { username: value.username, password: value.password },
    }
  }
}

const dynamicMockAuthAccountStore = new DynamicMockAuthAccountStore()

export function registerDynamicMockAuthAccount(
  username: string,
  password: string,
): void {
  const next = dynamicMockAuthAccountStore
    .read()
    .filter((account) => account.username !== username)
  next.push({ username, password })
  dynamicMockAuthAccountStore.write(next)
}

export function findDynamicMockAuthAccount(
  username: string,
  password: string,
): DynamicMockAuthAccountLookup {
  const account = dynamicMockAuthAccountStore
    .read()
    .find(
      (account) =>
        account.username === username && account.password === password,
    )
  return account
    ? { kind: DynamicMockAuthAccountLookupKind.Found, account }
    : { kind: DynamicMockAuthAccountLookupKind.Missing }
}
