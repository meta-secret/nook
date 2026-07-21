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

export function findMockAuthAccount(
  username: string,
  password: string,
): MockAuthAccount | undefined {
  return MOCK_AUTH_ACCOUNTS.find(
    (account) => account.username === username && account.password === password,
  )
}

/** Plain (non-2FA) accounts that can complete `/plain/success`. */
export function findPlainMockAuthAccount(
  username: string,
  password: string,
): MockAuthAccount | undefined {
  const account = findMockAuthAccount(username, password)
  if (!account || account.totpSecret) return undefined
  return account
}
