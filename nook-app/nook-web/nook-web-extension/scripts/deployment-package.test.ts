import { describe, expect, test } from 'bun:test'
import { extensionArchiveName } from './deployment-package'

describe('extension deployment archive', () => {
  test('uses predictable channel-specific names', () => {
    expect(extensionArchiveName('production', '1.2.3')).toBe(
      'nook-passwords-1.2.3.zip',
    )
    expect(extensionArchiveName('development', '1.2.3')).toBe(
      'nook-passwords-dev.zip',
    )
    expect(extensionArchiveName('local', '1.2.3')).toBe(
      'nook-passwords-local.zip',
    )
    expect(extensionArchiveName('pr-408', '1.2.3')).toBe(
      'nook-passwords-pr-408.zip',
    )
  })

  test('rejects unsafe production versions', () => {
    expect(() => extensionArchiveName('production', '../latest')).toThrow()
  })
})
