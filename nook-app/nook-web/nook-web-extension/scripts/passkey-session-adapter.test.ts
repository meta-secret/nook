import { describe, expect, test } from 'bun:test'
import {
  PasskeyAccountListKind,
  passkeyAccountListFromSession,
} from '../src/background/service-worker/passkey-session-adapter'

describe('passkey account-list session adapter', () => {
  test('distinguishes a valid empty list from an unavailable response', () => {
    expect(passkeyAccountListFromSession({ ok: true, accounts: [] })).toEqual({
      kind: PasskeyAccountListKind.Ready,
      accounts: [],
    })
    expect(passkeyAccountListFromSession({ ok: false })).toEqual({
      kind: PasskeyAccountListKind.Invalid,
    })
  })

  test('rejects the complete list when any account is malformed', () => {
    expect(
      passkeyAccountListFromSession({
        ok: true,
        accounts: [
          {
            credentialId: 'credential-id',
            userName: 'person@example.test',
            userDisplayName: 'Person',
          },
          { credentialId: '' },
        ],
      }),
    ).toEqual({ kind: PasskeyAccountListKind.Invalid })
  })

  test('rejects sparse account arrays instead of skipping their holes', () => {
    const accounts: unknown[] = []
    accounts.length = 1

    expect(passkeyAccountListFromSession({ ok: true, accounts })).toEqual({
      kind: PasskeyAccountListKind.Invalid,
    })
  })
})
