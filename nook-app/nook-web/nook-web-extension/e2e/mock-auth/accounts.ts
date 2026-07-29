/** Test-only fixture identities for the local mock auth SPA. */

export type MockAuthAccount = {
  username: string
  password: string
  /** Base32 TOTP seed when the account requires a second factor. */
  totpSecret?: string
}

export const MOCK_AUTH_ACCOUNTS: readonly MockAuthAccount[] = [
  {
    username: 'alice@nook.test',
    password: 'extension-fill-password',
  },
  {
    username: 'bob@nook.test',
    password: 'second-extension-password',
  },
  {
    username: 'alice-2fa@nook.test',
    password: 'extension-fill-password',
    // Classic demo seed ("Hello!"); never used outside fixtures.
    totpSecret: 'JBSWY3DPEHPK3PXP',
  },
] as const

/** Second TOTP seed for multi-authenticator chooser coverage. */
export const MOCK_AUTH_SECOND_TOTP_SECRET = 'GEZDGNBVGY3TQOJQ'

export const MOCK_AUTH_DEFAULT_PIN = '123456'

export enum MockAuthAccountLookupKind {
  Missing = 'missing',
  Found = 'found',
}

export type MockAuthAccountLookup =
  | { kind: MockAuthAccountLookupKind.Missing }
  | { kind: MockAuthAccountLookupKind.Found; account: MockAuthAccount }

export function findMockAuthAccount(
  username: string,
  password: string,
): MockAuthAccountLookup {
  const account = MOCK_AUTH_ACCOUNTS.find(
    (account) => account.username === username && account.password === password,
  )
  return account
    ? { kind: MockAuthAccountLookupKind.Found, account }
    : { kind: MockAuthAccountLookupKind.Missing }
}

/** Plain (non-2FA) accounts that can complete `/plain/success`. */
export function findPlainMockAuthAccount(
  username: string,
  password: string,
): MockAuthAccountLookup {
  const lookup = findMockAuthAccount(username, password)
  if (
    lookup.kind === MockAuthAccountLookupKind.Missing ||
    lookup.account.totpSecret
  ) {
    return { kind: MockAuthAccountLookupKind.Missing }
  }
  return lookup
}
