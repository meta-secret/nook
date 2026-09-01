import { describe, expect, test } from 'bun:test'
import {
  PageResponseAction,
  websitePasskeyOptionsDisposition,
  WebsitePasskeyOptionsDispositionKind,
} from '../src/content/webauthn-options-response'
import { WebsitePasskeyOptionsStatus } from '../src/lib/webauthn-messages'

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
})
