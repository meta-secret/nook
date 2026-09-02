import { describe, expect, test } from 'bun:test'
import {
  decode_website_passkey_account_list,
  WebsitePasskeyAccountListKind,
} from '../src/background/service-worker/passkey-session-adapter'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'

await companionWasmReady

describe('passkey account-list session adapter', () => {
  test('distinguishes a valid empty list from an unavailable response', () => {
    expect(
      decode_website_passkey_account_list({ ok: true, accounts: [] }),
    ).toEqual({
      kind: WebsitePasskeyAccountListKind.Ready,
      accounts: [],
    })
    expect(decode_website_passkey_account_list({ ok: false })).toEqual({
      kind: WebsitePasskeyAccountListKind.Invalid,
    })
  })

  test('rejects the complete list when any account is malformed', () => {
    expect(
      decode_website_passkey_account_list({
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
    ).toEqual({ kind: WebsitePasskeyAccountListKind.Invalid })
  })

  test('rejects sparse account arrays instead of skipping their holes', () => {
    const accounts: unknown[] = []
    accounts.length = 1

    expect(decode_website_passkey_account_list({ ok: true, accounts })).toEqual(
      {
        kind: WebsitePasskeyAccountListKind.Invalid,
      },
    )
  })
})
