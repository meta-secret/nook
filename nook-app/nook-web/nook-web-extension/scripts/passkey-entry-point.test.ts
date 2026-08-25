import { describe, expect, test } from 'bun:test'
import {
  PasskeyEntryPointKind,
  passkeyEntryPointKind,
} from '../src/lib/passkey-entry-point'

describe('Pilot passkey entry-point selection', () => {
  test('uses an explicit site control when one is available', () => {
    const args: Parameters<typeof passkeyEntryPointKind>[0] = {
      action: 'create-passkey',
      siteControlPresent: true,
    }
    expect(passkeyEntryPointKind(args)).toBe(PasskeyEntryPointKind.SiteControl)
  })

  test('uses scoped authentication advance for a confident passkey match', () => {
    const args: Parameters<typeof passkeyEntryPointKind>[0] = {
      action: 'use-passkey',
      siteControlPresent: false,
    }
    expect(passkeyEntryPointKind(args)).toBe(
      PasskeyEntryPointKind.ScopedAuthenticationAdvance,
    )
  })

  test('does not create a passkey without an explicit site control', () => {
    const args: Parameters<typeof passkeyEntryPointKind>[0] = {
      action: 'create-passkey',
      siteControlPresent: false,
    }
    expect(passkeyEntryPointKind(args)).toBe(PasskeyEntryPointKind.Unavailable)
  })
})
