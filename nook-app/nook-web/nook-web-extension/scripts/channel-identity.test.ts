import { describe, expect, test } from 'bun:test'
import {
  extensionChannelIdentity,
  extensionIdFromManifestKey,
  parseExtensionChannel,
} from './channel-identity'

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

  test('normalizes supported channels and rejects ambiguous identities', () => {
    expect(parseExtensionChannel(' Development ')).toBe('development')
    expect(parseExtensionChannel('PR-123')).toBe('pr-123')
    expect(parseExtensionChannel('local')).toBe('local')
    expect(() => parseExtensionChannel('preview')).toThrow()
    expect(() => parseExtensionChannel('pr-0')).toThrow()
  })
})
