import { describe, expect, test } from 'bun:test'
import {
  extensionArchiveName,
  extensionInstallTarget,
  ExtensionInstallMethod,
} from './deployment-package'
import { ExtensionReleaseChannel } from './channel-identity'

describe('extension deployment archive', () => {
  test('uses predictable channel-specific names', () => {
    expect(
      extensionArchiveName(ExtensionReleaseChannel.Production, '1.2.3'),
    ).toBe('nook-passwords-1.2.3.zip')
    expect(
      extensionArchiveName(ExtensionReleaseChannel.Development, '1.2.3'),
    ).toBe('nook-passwords-dev.zip')
    expect(extensionArchiveName(ExtensionReleaseChannel.Local, '1.2.3')).toBe(
      'nook-passwords-local.zip',
    )
    expect(extensionArchiveName('pr-408', '1.2.3')).toBe(
      'nook-passwords-pr-408.zip',
    )
  })

  test('rejects unsafe production versions', () => {
    expect(() =>
      extensionArchiveName(ExtensionReleaseChannel.Production, '../latest'),
    ).toThrow()
  })

  test('sends production installs to the Chrome Web Store', () => {
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
    expect(
      extensionInstallTarget(
        ExtensionReleaseChannel.Production,
        extensionId,
        'https://nokey.sh/downloads/nook-passwords-1.2.3.zip',
      ),
    ).toEqual({
      install_method: ExtensionInstallMethod.ChromeWebStore,
      install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
    })
  })

  test('keeps non-production installs on the channel ZIP', () => {
    const downloadUrl =
      'https://pr-408.nokey-sh.pages.dev/downloads/nook-passwords-pr-408.zip'
    expect(
      extensionInstallTarget(
        'pr-408',
        'abcdefghijklmnopabcdefghijklmnop',
        downloadUrl,
      ),
    ).toEqual({
      install_method: ExtensionInstallMethod.ManualZip,
      install_url: downloadUrl,
    })
  })

  test('rejects invalid extension IDs when creating install links', () => {
    expect(() =>
      extensionInstallTarget(
        ExtensionReleaseChannel.Production,
        'invalid',
        'https://nokey.sh/downloads/nook-passwords-1.2.3.zip',
      ),
    ).toThrow()
  })
})
