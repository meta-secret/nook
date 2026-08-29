import { describe, expect, test } from 'bun:test'
import {
  PasskeyEntryPointKind,
  passkeyEntryPointKind,
} from '../src/lib/passkey-entry-point'

describe('Pilot passkey entry-point selection', () => {
  test('uses an explicit site control when one is available', () => {
    const args: Parameters<typeof passkeyEntryPointKind>[0] = {
      siteControlPresent: true,
    }
    expect(passkeyEntryPointKind(args)).toBe(PasskeyEntryPointKind.SiteControl)
  })

  test('does not infer a passkey control from a confident workflow match', () => {
    const args: Parameters<typeof passkeyEntryPointKind>[0] = {
      siteControlPresent: false,
    }
    expect(passkeyEntryPointKind(args)).toBe(PasskeyEntryPointKind.Unavailable)
  })
})
