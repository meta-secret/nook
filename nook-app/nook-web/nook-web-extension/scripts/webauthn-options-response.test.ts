import { describe, expect, test } from 'bun:test'
import {
  DeclinedPasskeyError,
  declinedPasskeyError,
  PageResponseAction,
  websitePasskeyOptionsDisposition,
  WebsitePasskeyOptionsDispositionKind,
  WebsitePasskeyUnavailableReason,
} from '../src/content/webauthn-options-response'
import { WebsitePasskeyOptionsStatus } from '../src/lib/webauthn-message-types'

describe('WebAuthn options content response', () => {
  test('rejects invalid vault options instead of falling back to the browser', () => {
    expect(
      websitePasskeyOptionsDisposition({
        ok: true,
        status: WebsitePasskeyOptionsStatus.Invalid,
        hasOptions: false,
      }),
    ).toEqual({
      kind: WebsitePasskeyOptionsDispositionKind.Respond,
      action: PageResponseAction.Error,
      reason: 'NotAllowedError',
    })
  })

  test('explains every request Nook cannot serve instead of handing it to the browser', () => {
    const cases: [
      Parameters<typeof websitePasskeyOptionsDisposition>[0],
      WebsitePasskeyUnavailableReason,
    ][] = [
      [
        {
          ok: true,
          status: WebsitePasskeyOptionsStatus.Ready,
          hasOptions: false,
        },
        WebsitePasskeyUnavailableReason.NoMatch,
      ],
      [
        {
          ok: true,
          status: WebsitePasskeyOptionsStatus.Locked,
          hasOptions: false,
        },
        WebsitePasskeyUnavailableReason.Locked,
      ],
      [
        {
          ok: true,
          status: WebsitePasskeyOptionsStatus.Unavailable,
          hasOptions: false,
        },
        WebsitePasskeyUnavailableReason.NoVault,
      ],
      [
        {
          ok: false,
          status: WebsitePasskeyOptionsStatus.Unavailable,
          hasOptions: false,
        },
        WebsitePasskeyUnavailableReason.CheckFailed,
      ],
      [
        {
          ok: true,
          status: WebsitePasskeyOptionsStatus.AlreadySaved,
          hasOptions: false,
        },
        WebsitePasskeyUnavailableReason.AlreadySaved,
      ],
    ]
    for (const [args, reason] of cases) {
      expect(websitePasskeyOptionsDisposition(args)).toEqual({
        kind: WebsitePasskeyOptionsDispositionKind.Explain,
        reason,
      })
    }
    expect(
      websitePasskeyOptionsDisposition({
        ok: true,
        status: WebsitePasskeyOptionsStatus.Ready,
        hasOptions: true,
      }),
    ).toEqual({ kind: WebsitePasskeyOptionsDispositionKind.Continue })
  })

  test('closing the already-saved card tells the site the passkey exists', () => {
    expect(
      declinedPasskeyError({
        kind: WebsitePasskeyOptionsDispositionKind.Explain,
        reason: WebsitePasskeyUnavailableReason.AlreadySaved,
      }),
    ).toBe(DeclinedPasskeyError.InvalidState)
    expect(
      declinedPasskeyError({
        kind: WebsitePasskeyOptionsDispositionKind.Explain,
        reason: WebsitePasskeyUnavailableReason.NoVault,
      }),
    ).toBe(DeclinedPasskeyError.NotAllowed)
    expect(
      declinedPasskeyError({
        kind: WebsitePasskeyOptionsDispositionKind.Continue,
      }),
    ).toBe(DeclinedPasskeyError.NotAllowed)
  })
})
