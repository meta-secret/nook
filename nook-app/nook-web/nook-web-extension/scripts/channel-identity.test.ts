import { describe, expect, test } from 'bun:test'
import type { ExtensionIdentityScope } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  extensionChannelIdentity,
  extensionIdentity,
  extensionIdFromManifestKey,
  ExtensionReleaseChannel,
  parseExtensionChannel,
} from './channel-identity'

const metaSecretIdentityScope: ExtensionIdentityScope = {
  kind: 'vaultIdentity',
  seedQualifier: 'meta-secret',
  displayQualifier: 'meta-secret.io',
}

describe('extension deployment channel identity', () => {
  test('is stable within a channel and isolated across channels', () => {
    const first = extensionChannelIdentity('pr-408')
    const rebuilt = extensionChannelIdentity('pr-408')
    const otherPr = extensionChannelIdentity('pr-409')
    const development = extensionChannelIdentity('development')
    const local = extensionChannelIdentity('local')
    const production = extensionChannelIdentity('production')

    expect(rebuilt).toEqual(first)
    expect(
      new Set([
        first.extensionId,
        otherPr.extensionId,
        development.extensionId,
        local.extensionId,
        production.extensionId,
      ]).size,
    ).toBe(5)
    expect(first.extensionId).toMatch(/^[a-p]{32}$/)
    expect(extensionIdFromManifestKey(first.manifestKey)).toBe(
      first.extensionId,
    )
  })

  // Installed extensions keep their storage only while these stay byte-identical.
  test.each([
    [
      'production',
      'depdgoplkcjjbncnmimlhafghmehkeog',
      'MCowBQYDK2VwAyEAzsrdqFDYA4XiMHk1DXTXnH8OW15g0hYEWegtXfxRwqg=',
    ],
    [
      'development',
      'clphnfonhfalcjjmmejdgjaoaobkhamd',
      'MCowBQYDK2VwAyEAuk3xX1n/iU49tK59Ss8zyZPhj/zryMrshFusnMTxG+0=',
    ],
    [
      'local',
      'lcjelgolincofkbkklmemdcfcdkckhej',
      'MCowBQYDK2VwAyEA8ccaUuM7uSNXS1OUmwBD8F0pIELFJxmO+AYb54lY02c=',
    ],
    [
      'pr-1',
      'madienhgmjnoaolkhlkhlblgbecmkagp',
      'MCowBQYDK2VwAyEACNjOgtqhkmLvIMWibdlDyMvv9WaoTYJDSbJOCR6Mw8E=',
    ],
  ])(
    'keeps the %s channel identity byte-identical',
    (channel, extensionId, manifestKey) => {
      const identity = extensionChannelIdentity(channel)
      expect(identity.extensionId).toBe(extensionId)
      expect(identity.manifestKey).toBe(manifestKey)
    },
  )

  test('gives the meta-secret production package its own identity and name', () => {
    const production = extensionChannelIdentity('production')
    const metaSecret = extensionIdentity('production', metaSecretIdentityScope)

    // Installed meta-secret extensions keep their storage only while these
    // stay byte-identical.
    expect(metaSecret.extensionId).toBe('khjcheibamemkakfjfbjloppehnplffp')
    expect(metaSecret.manifestKey).toBe(
      'MCowBQYDK2VwAyEAlz1hhMTmfY2Vz22nPp1xQ5f3MeeQ5HX9rdwXqfGNCTc=',
    )
    expect(metaSecret.extensionId).not.toBe(production.extensionId)
    expect(metaSecret.manifestKey).not.toBe(production.manifestKey)
    expect(extensionIdFromManifestKey(metaSecret.manifestKey)).toBe(
      metaSecret.extensionId,
    )
    expect(metaSecret.name).toBe('Nook Passwords (meta-secret.io)')
    expect(extensionIdentity('production', metaSecretIdentityScope)).toEqual(
      metaSecret,
    )
  })

  test('normalizes supported channels and rejects ambiguous identities', () => {
    expect(parseExtensionChannel(' Development ')).toBe(
      ExtensionReleaseChannel.Development,
    )
    expect(parseExtensionChannel('PR-123')).toBe('pr-123')
    expect(parseExtensionChannel('local')).toBe(ExtensionReleaseChannel.Local)
    expect(() => parseExtensionChannel('preview')).toThrow()
    expect(() => parseExtensionChannel('pr-0')).toThrow()
  })
})
